"""Mide inicialización, memoria y latencia de inferencia con artefactos reales."""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections.abc import Callable
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).parents[1]))

from ml.inference import RecommendationEngine


def rss_bytes() -> int:
    """Lee el RSS del proceso Linux sin añadir una dependencia de monitorización."""
    for line in Path("/proc/self/status").read_text(encoding="utf-8").splitlines():
        if line.startswith("VmRSS:"):
            return int(line.split()[1]) * 1024
    return 0


def measure(name: str, operation: Callable[[], object]) -> dict[str, object]:
    """Ejecuta una operación de recomendación y resume su coste observable."""
    before = rss_bytes()
    started = time.perf_counter()
    result = operation()
    elapsed = time.perf_counter() - started
    return {"operation": name, "seconds": elapsed, "rss_before_bytes": before, "rss_after_bytes": rss_bytes(), "rows": len(result)}  # type: ignore[arg-type]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--output", type=Path, default=Path("artifacts/v2/hybrid/inference_benchmark.json"))
    parser.add_argument("--device", default=None)
    parser.add_argument("--k", type=int, default=10)
    return parser.parse_args()


def main(args: argparse.Namespace) -> None:
    initial_rss = rss_bytes()
    started = time.perf_counter()
    engine = RecommendationEngine(args.root, device=args.device, version="v2")
    initialization = {"seconds": time.perf_counter() - started, "rss_before_bytes": initial_rss, "rss_after_bytes": rss_bytes()}
    user_id = next(user_id for user_id, user_idx in engine.user_to_idx.items() if engine._profile_for_user(int(user_idx)) is not None)
    book_id = str(engine.content_book_ids[0])
    operations = [
        measure("collaborative", lambda: engine.recommend_collaborative(user_id, args.k)),
        measure("similar", lambda: engine.recommend_similar(book_id, args.k)),
        measure("hybrid", lambda: engine.recommend_hybrid(user_id, args.k)),
        measure("content_only", lambda: engine.recommend_content_only(user_id, args.k)),
        measure("new_user", lambda: engine.recommend_new_user({"genres": ["poetry"], "language": ["eng"]}, args.k)),
    ]
    payload = {"version": "v2", "device": str(engine.device), "k": args.k, "initialization": initialization, "operations": operations}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main(parse_args())
