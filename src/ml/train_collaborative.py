"""Entrenamiento por épocas de factorización matricial desde Parquet."""

from __future__ import annotations

import argparse
import csv
import json
import logging
import random
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pyarrow.parquet as pq
import torch
from torch import nn
from torch.utils.data import DataLoader
import matplotlib.pyplot as plt

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).parents[1]))

from ml.collaborative import MatrixFactorization
from ml.parquet_loader import ParquetBatchDataset, parquet_rating_mean


LOGGER = logging.getLogger(__name__)


def set_seed(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def process_rss_bytes() -> int:
    """Devuelve RSS del proceso actual en Linux sin una dependencia adicional."""
    for line in Path("/proc/self/status").read_text(encoding="utf-8").splitlines():
        if line.startswith("VmRSS:"):
            return int(line.split()[1]) * 1024
    return 0


def gpu_snapshot() -> tuple[int | None, int | None]:
    """Consulta uso de GPU y VRAM; retorna nulos si nvidia-smi no está disponible."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used", "--format=csv,noheader,nounits"],
            capture_output=True,
            check=True,
            text=True,
            timeout=5,
        )
        utilization, memory = result.stdout.splitlines()[0].split(",")
        return int(utilization.strip()), int(memory.strip())
    except (FileNotFoundError, subprocess.SubprocessError, ValueError, IndexError):
        return None, None


def make_loader(dataset: ParquetBatchDataset, device: torch.device) -> DataLoader:
    """El dataset ya emite batches; un solo proceso evita lecturas duplicadas."""
    return DataLoader(dataset, batch_size=None, num_workers=0, pin_memory=device.type == "cuda")


@torch.no_grad()
def evaluate(model: MatrixFactorization, loader: DataLoader, device: torch.device) -> dict[str, float | int]:
    model.eval()
    squared_error = absolute_error = 0.0
    rows = batches = 0
    for users, books, ratings in loader:
        users = users.to(device, non_blocking=True)
        books = books.to(device, non_blocking=True)
        ratings = ratings.to(device, non_blocking=True)
        errors = model(users, books) - ratings
        squared_error += float(errors.square().sum().item())
        absolute_error += float(errors.abs().sum().item())
        rows += len(ratings)
        batches += 1
    return {
        "mse": squared_error / rows,
        "mae": absolute_error / rows,
        "rmse": (squared_error / rows) ** 0.5,
        "rows": rows,
        "batches": batches,
    }


@torch.no_grad()
def evaluate_global_mean(loader: DataLoader, global_mean: float, device: torch.device) -> dict[str, float]:
    """Evalúa el baseline que solo conoce la media calculada desde train."""
    squared_error = absolute_error = 0.0
    rows = 0
    for _, _, ratings in loader:
        errors = torch.full_like(ratings.to(device, non_blocking=True), global_mean) - ratings.to(device, non_blocking=True)
        squared_error += float(errors.square().sum().item())
        absolute_error += float(errors.abs().sum().item())
        rows += len(ratings)
    return {"mse": squared_error / rows, "mae": absolute_error / rows, "rmse": (squared_error / rows) ** 0.5}


def train_epoch(
    model: MatrixFactorization,
    loader: DataLoader,
    optimizer: torch.optim.Optimizer,
    loss_fn: nn.Module,
    device: torch.device,
    *,
    monitor_every: int,
) -> dict[str, float | int | None]:
    """Entrena una época completa y registra consumo sin retener predicciones."""
    if device.type == "cuda":
        torch.cuda.reset_peak_memory_stats(device)
    model.train()
    start = time.perf_counter()
    total_loss = 0.0
    rows = batches = 0
    gpu_utilizations: list[int] = []
    gpu_memory_samples: list[int] = []
    for batch_index, (users, books, ratings) in enumerate(loader, start=1):
        users = users.to(device, non_blocking=True)
        books = books.to(device, non_blocking=True)
        ratings = ratings.to(device, non_blocking=True)
        optimizer.zero_grad(set_to_none=True)
        loss = loss_fn(model(users, books), ratings)
        loss.backward()
        optimizer.step()
        total_loss += float(loss.item()) * len(ratings)
        rows += len(ratings)
        batches += 1
        if device.type == "cuda" and (batch_index % monitor_every == 0 or batch_index == 1):
            utilization, memory = gpu_snapshot()
            if utilization is not None:
                gpu_utilizations.append(utilization)
            if memory is not None:
                gpu_memory_samples.append(memory)
    if device.type == "cuda":
        torch.cuda.synchronize(device)
    utilization, memory = gpu_snapshot() if device.type == "cuda" else (None, None)
    if utilization is not None:
        gpu_utilizations.append(utilization)
    if memory is not None:
        gpu_memory_samples.append(memory)
    return {
        "train_mse": total_loss / rows,
        "train_rows": rows,
        "train_batches": batches,
        "epoch_seconds": time.perf_counter() - start,
        "process_rss_bytes": process_rss_bytes(),
        "peak_vram_allocated_bytes": torch.cuda.max_memory_allocated(device) if device.type == "cuda" else 0,
        "gpu_utilization_mean_percent": sum(gpu_utilizations) / len(gpu_utilizations) if gpu_utilizations else None,
        "gpu_memory_max_mib": max(gpu_memory_samples) if gpu_memory_samples else None,
    }


def _training_paths(ml_dir: Path) -> tuple[Path, Path, Path, Path]:
    train, valid = ml_dir / "train.parquet", ml_dir / "valid.parquet"
    users, books = ml_dir / "user_mapping.parquet", ml_dir / "book_mapping.parquet"
    if not train.exists() or not valid.exists() or not users.exists() or not books.exists():
        raise FileNotFoundError("Faltan particiones o mapeos requeridos en data/ml_v2.")
    return train, valid, users, books


def run_pilot(
    ml_dir: Path,
    output_dir: Path,
    *,
    factors: int = 32,
    batch_size: int = 65_536,
    learning_rate: float = 0.005,
    weight_decay: float = 1e-5,
    seed: int = 2026,
    max_batches: int | None = None,
    monitor_every: int = 100,
) -> dict[str, float | int | str | None]:
    """Ejecuta un piloto de una época y valida sin consultar test.parquet."""
    if max_batches is not None and max_batches < 1:
        raise ValueError("max_batches debe ser positivo cuando se especifica.")
    train_path, valid_path, user_mapping_path, book_mapping_path = _training_paths(ml_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    if any(output_dir.iterdir()):
        raise FileExistsError(f"El directorio de salida no está vacío: {output_dir}")

    set_seed(seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    train_dataset = ParquetBatchDataset(train_path, batch_size, shuffle=True, seed=seed, epoch=1)
    valid_dataset = ParquetBatchDataset(valid_path, batch_size, shuffle=False, seed=seed)
    train_loader, valid_loader = make_loader(train_dataset, device), make_loader(valid_dataset, device)
    num_users = pq.ParquetFile(user_mapping_path).metadata.num_rows
    num_items = pq.ParquetFile(book_mapping_path).metadata.num_rows
    global_mean = parquet_rating_mean(train_path)
    model = MatrixFactorization(num_users, num_items, factors, global_mean).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate, weight_decay=weight_decay)
    loss_fn = nn.MSELoss()

    if device.type == "cuda":
        torch.cuda.reset_peak_memory_stats(device)
    model.train()
    start = time.perf_counter()
    total_loss = 0.0
    rows = batches = 0
    gpu_utilizations: list[int] = []
    gpu_memory_samples: list[int] = []
    for batch_index, (users, books, ratings) in enumerate(train_loader, start=1):
        users = users.to(device, non_blocking=True)
        books = books.to(device, non_blocking=True)
        ratings = ratings.to(device, non_blocking=True)
        optimizer.zero_grad(set_to_none=True)
        loss = loss_fn(model(users, books), ratings)
        loss.backward()
        optimizer.step()
        total_loss += float(loss.item()) * len(ratings)
        rows += len(ratings)
        batches += 1
        if device.type == "cuda" and (batch_index % monitor_every == 0 or batch_index == 1):
            utilization, memory = gpu_snapshot()
            if utilization is not None:
                gpu_utilizations.append(utilization)
            if memory is not None:
                gpu_memory_samples.append(memory)
        if max_batches is not None and batches >= max_batches:
            break
    if device.type == "cuda":
        torch.cuda.synchronize(device)
    epoch_seconds = time.perf_counter() - start
    validation = evaluate(model, valid_loader, device)
    peak_vram = torch.cuda.max_memory_allocated(device) if device.type == "cuda" else 0
    snapshot_utilization, snapshot_memory = gpu_snapshot() if device.type == "cuda" else (None, None)
    if snapshot_utilization is not None:
        gpu_utilizations.append(snapshot_utilization)
    if snapshot_memory is not None:
        gpu_memory_samples.append(snapshot_memory)
    result: dict[str, float | int | str | None] = {
        "seed": seed,
        "device": str(device),
        "factors": factors,
        "batch_size": batch_size,
        "learning_rate": learning_rate,
        "weight_decay": weight_decay,
        "global_mean_train": global_mean,
        "train_batches": batches,
        "train_rows_processed": rows,
        "train_rows_expected": train_dataset.num_rows,
        "train_rows_complete_epoch": rows == train_dataset.num_rows,
        "train_mse": total_loss / rows,
        "epoch_seconds": epoch_seconds,
        "process_rss_bytes": process_rss_bytes(),
        "peak_vram_allocated_bytes": peak_vram,
        "gpu_utilization_mean_percent": sum(gpu_utilizations) / len(gpu_utilizations) if gpu_utilizations else None,
        "gpu_utilization_samples": len(gpu_utilizations),
        "gpu_memory_max_mib": max(gpu_memory_samples) if gpu_memory_samples else None,
        "validation_mse": validation["mse"],
        "validation_mae": validation["mae"],
        "validation_rmse": validation["rmse"],
        "validation_rows": validation["rows"],
        "validation_batches": validation["batches"],
        "max_batches": max_batches,
    }
    torch.save({"state_dict": model.state_dict(), "pilot": result}, output_dir / "pilot_model.pt")
    (output_dir / "pilot_metrics.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def run_training(
    ml_dir: Path,
    output_dir: Path,
    *,
    factors: int = 32,
    batch_size: int = 65_536,
    learning_rate: float = 0.005,
    weight_decay: float = 1e-5,
    max_epochs: int = 12,
    patience: int = 3,
    seed: int = 2026,
    monitor_every: int = 50,
) -> dict[str, object]:
    """Entrena desde inicialización nueva y selecciona el checkpoint por validación."""
    if max_epochs < 1 or patience < 1:
        raise ValueError("max_epochs y patience deben ser positivos.")
    train_path, valid_path, user_mapping_path, book_mapping_path = _training_paths(ml_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    final_names = ("best_model.pt", "config.json", "metrics.json", "training_history.csv", "loss_curve.png")
    if any((output_dir / name).exists() for name in final_names):
        raise FileExistsError(f"Ya existen artefactos de entrenamiento en {output_dir}.")

    set_seed(seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    train_dataset = ParquetBatchDataset(train_path, batch_size, shuffle=True, seed=seed)
    valid_dataset = ParquetBatchDataset(valid_path, batch_size, shuffle=False, seed=seed)
    train_loader, valid_loader = make_loader(train_dataset, device), make_loader(valid_dataset, device)
    num_users = pq.ParquetFile(user_mapping_path).metadata.num_rows
    num_items = pq.ParquetFile(book_mapping_path).metadata.num_rows
    global_mean = parquet_rating_mean(train_path)
    model = MatrixFactorization(num_users, num_items, factors, global_mean).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate, weight_decay=weight_decay)
    loss_fn = nn.MSELoss()
    baseline = evaluate_global_mean(valid_loader, global_mean, device)
    config: dict[str, object] = {
        "seed": seed,
        "device": str(device),
        "factors": factors,
        "batch_size": batch_size,
        "learning_rate": learning_rate,
        "weight_decay": weight_decay,
        "loss": "MSELoss",
        "max_epochs": max_epochs,
        "patience": patience,
        "global_mean": global_mean,
        "num_users": num_users,
        "num_items": num_items,
        "train_rows": train_dataset.num_rows,
        "valid_rows": valid_dataset.num_rows,
        "data_loader": "PyArrow row groups shuffled per epoch; num_workers=0",
        "selection_split": "valid",
        "test_used": False,
    }
    history: list[dict[str, float | int | None]] = []
    best_valid_mse = float("inf")
    best_epoch = 0
    wait = 0
    stop_reason = "max_epochs_reached"
    total_start = time.perf_counter()
    for epoch in range(1, max_epochs + 1):
        train_dataset.set_epoch(epoch)
        row = {"epoch": epoch, **train_epoch(model, train_loader, optimizer, loss_fn, device, monitor_every=monitor_every)}
        if row["train_rows"] != train_dataset.num_rows:
            raise RuntimeError("La época no recorrió exactamente todas las filas de entrenamiento.")
        valid_start = time.perf_counter()
        valid = evaluate(model, valid_loader, device)
        row.update({
            "valid_mse": valid["mse"],
            "valid_mae": valid["mae"],
            "valid_rmse": valid["rmse"],
            "valid_seconds": time.perf_counter() - valid_start,
        })
        history.append(row)
        LOGGER.info("Época %d: %s", epoch, json.dumps(row, ensure_ascii=False))
        if float(valid["mse"]) < best_valid_mse - 1e-6:
            best_valid_mse = float(valid["mse"])
            best_epoch = epoch
            wait = 0
            torch.save(
                {"state_dict": model.state_dict(), "epoch": epoch, "valid_mse": best_valid_mse, "config": config},
                output_dir / "best_model.pt",
            )
        else:
            wait += 1
            if wait >= patience:
                stop_reason = f"early_stopping_patience_{patience}"
                break
    total_seconds = time.perf_counter() - total_start
    with (output_dir / "training_history.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(history[0]))
        writer.writeheader()
        writer.writerows(history)
    plt.figure(figsize=(8, 4))
    plt.plot([row["epoch"] for row in history], [row["train_mse"] for row in history], label="entrenamiento")
    plt.plot([row["epoch"] for row in history], [row["valid_mse"] for row in history], label="validación")
    plt.xlabel("Época")
    plt.ylabel("MSE")
    plt.title("Pérdida MSE por época: colaborativo V2")
    plt.legend()
    plt.tight_layout()
    plt.savefig(output_dir / "loss_curve.png", dpi=160)
    plt.close()
    shutil.copy2(user_mapping_path, output_dir / "user_mapping.parquet")
    shutil.copy2(book_mapping_path, output_dir / "book_mapping.parquet")
    config["best_epoch"] = best_epoch
    (output_dir / "config.json").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    best_row = next(row for row in history if row["epoch"] == best_epoch)
    metrics: dict[str, object] = {
        "selection_split": "valid",
        "test_used": False,
        "baseline_global_mean_valid": baseline,
        "matrix_factorization_valid": {"mse": best_row["valid_mse"], "mae": best_row["valid_mae"], "rmse": best_row["valid_rmse"]},
        "best_epoch": best_epoch,
        "best_valid_mse": best_valid_mse,
        "epochs_executed": len(history),
        "stop_reason": stop_reason,
        "total_seconds": total_seconds,
        "epoch_resource_summary": {
            "max_process_rss_bytes": max(int(row["process_rss_bytes"]) for row in history),
            "max_peak_vram_allocated_bytes": max(int(row["peak_vram_allocated_bytes"]) for row in history),
            "max_gpu_memory_mib": max((row["gpu_memory_max_mib"] or 0) for row in history),
            "mean_gpu_utilization_percent": sum(float(row["gpu_utilization_mean_percent"] or 0) for row in history) / len(history),
        },
        "overfitting_signal": (
            "validation_mse_increased_after_best_epoch"
            if best_epoch < len(history) and float(history[-1]["valid_mse"]) > best_valid_mse
            else "none_observed"
        ),
    }
    (output_dir / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    return metrics


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ml-dir", type=Path, default=Path("data/ml_v2"))
    parser.add_argument("--output-dir", type=Path, default=Path("artifacts/v2/collaborative_mf/pilot"))
    parser.add_argument("--mode", choices=("pilot", "train"), default="pilot")
    parser.add_argument("--factors", type=int, default=32)
    parser.add_argument("--batch-size", type=int, default=65_536)
    parser.add_argument("--learning-rate", type=float, default=0.005)
    parser.add_argument("--weight-decay", type=float, default=1e-5)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--max-batches", type=int)
    parser.add_argument("--monitor-every", type=int, default=100)
    parser.add_argument("--max-epochs", type=int, default=12)
    parser.add_argument("--patience", type=int, default=3)
    return parser.parse_args()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    args = parse_args()
    if args.mode == "pilot":
        metrics = run_pilot(
            args.ml_dir, args.output_dir, factors=args.factors, batch_size=args.batch_size,
            learning_rate=args.learning_rate, weight_decay=args.weight_decay, seed=args.seed,
            max_batches=args.max_batches, monitor_every=args.monitor_every,
        )
        LOGGER.info("Piloto terminado: %s", json.dumps(metrics, ensure_ascii=False))
    else:
        metrics = run_training(
            args.ml_dir, args.output_dir, factors=args.factors, batch_size=args.batch_size,
            learning_rate=args.learning_rate, weight_decay=args.weight_decay, max_epochs=args.max_epochs,
            patience=args.patience, seed=args.seed, monitor_every=args.monitor_every,
        )
        LOGGER.info("Entrenamiento terminado: %s", json.dumps(metrics, ensure_ascii=False))
