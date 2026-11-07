"""Carga por lotes reproducible para particiones Parquet de recomendación."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Iterator

import numpy as np
import pyarrow.parquet as pq
import torch
from torch.utils.data import IterableDataset, get_worker_info


class ParquetBatchDataset(IterableDataset[tuple[torch.Tensor, torch.Tensor, torch.Tensor]]):
    """Emite batches desde row groups Parquet sin cargar la partición completa.

    Cada epoch permuta determinísticamente los row groups y las filas de cada
    grupo. Con workers, cada réplica recibe grupos disjuntos; el piloto usa un
    único worker para no competir por E/S ni producir batches parciales extra.
    """

    def __init__(
        self,
        path: Path,
        batch_size: int,
        *,
        shuffle: bool,
        seed: int,
        epoch: int = 0,
    ) -> None:
        super().__init__()
        if batch_size < 1:
            raise ValueError("batch_size debe ser positivo.")
        self.path = Path(path)
        self.batch_size = batch_size
        self.shuffle = shuffle
        self.seed = seed
        self.epoch = epoch
        metadata = pq.ParquetFile(self.path).metadata
        self.num_rows = metadata.num_rows
        self.num_row_groups = metadata.num_row_groups

    def set_epoch(self, epoch: int) -> None:
        """Cambia la permutación determinística que se usará en la siguiente iteración."""
        self.epoch = epoch

    def __len__(self) -> int:
        return math.ceil(self.num_rows / self.batch_size)

    def __iter__(self) -> Iterator[tuple[torch.Tensor, torch.Tensor, torch.Tensor]]:
        worker = get_worker_info()
        worker_id = 0 if worker is None else worker.id
        worker_count = 1 if worker is None else worker.num_workers
        rng = np.random.default_rng(self.seed + self.epoch)
        row_groups = np.arange(self.num_row_groups)
        if self.shuffle:
            rng.shuffle(row_groups)
        row_groups = row_groups[worker_id::worker_count]

        parquet = pq.ParquetFile(self.path)
        pending: tuple[np.ndarray, np.ndarray, np.ndarray] | None = None
        for row_group in row_groups:
            table = parquet.read_row_group(int(row_group), columns=["user_idx", "book_idx", "rating"])
            # Arrow puede exponer buffers de solo lectura; las copias por row
            # group conservan la seguridad de torch.from_numpy sin cargar el archivo completo.
            users = table.column("user_idx").combine_chunks().to_numpy(zero_copy_only=False).astype(np.int64, copy=True)
            books = table.column("book_idx").combine_chunks().to_numpy(zero_copy_only=False).astype(np.int64, copy=True)
            ratings = table.column("rating").combine_chunks().to_numpy(zero_copy_only=False).astype(np.float32, copy=True)
            if self.shuffle:
                order = rng.permutation(len(users))
                users, books, ratings = users[order], books[order], ratings[order]

            if pending is not None:
                needed = self.batch_size - len(pending[0])
                take = min(needed, len(users))
                pending = tuple(np.concatenate((left, right[:take])) for left, right in zip(pending, (users, books, ratings)))
                users, books, ratings = users[take:], books[take:], ratings[take:]
                if len(pending[0]) == self.batch_size:
                    yield tuple(torch.from_numpy(values) for values in pending)
                    pending = None

            while len(users) >= self.batch_size:
                yield (
                    torch.from_numpy(users[:self.batch_size]),
                    torch.from_numpy(books[:self.batch_size]),
                    torch.from_numpy(ratings[:self.batch_size]),
                )
                users, books, ratings = users[self.batch_size:], books[self.batch_size:], ratings[self.batch_size:]
            if len(users):
                pending = (users, books, ratings)

        if pending is not None:
            yield tuple(torch.from_numpy(values) for values in pending)


def parquet_rating_mean(path: Path, batch_rows: int = 1_000_000) -> float:
    """Calcula la media de ratings mediante streaming de batches Arrow."""
    total = 0.0
    rows = 0
    parquet = pq.ParquetFile(path)
    for batch in parquet.iter_batches(batch_size=batch_rows, columns=["rating"]):
        values = batch.column("rating").to_numpy(zero_copy_only=False)
        total += float(values.sum(dtype=np.float64))
        rows += len(values)
    if rows == 0:
        raise ValueError(f"La partición no contiene filas: {path}")
    return total / rows
