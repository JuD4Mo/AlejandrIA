"""Modelo explícito de factorización matricial con PyTorch."""

from __future__ import annotations

import torch
from torch import nn


class MatrixFactorization(nn.Module):
    """Embeddings y sesgos usuario-ítem para predecir ratings explícitos."""

    def __init__(self, num_users: int, num_items: int, factors: int, global_mean: float) -> None:
        super().__init__()
        self.user_embedding = nn.Embedding(num_users, factors)
        self.item_embedding = nn.Embedding(num_items, factors)
        self.user_bias = nn.Embedding(num_users, 1)
        self.item_bias = nn.Embedding(num_items, 1)
        self.register_buffer("global_mean", torch.tensor(global_mean, dtype=torch.float32))
        nn.init.normal_(self.user_embedding.weight, std=0.05)
        nn.init.normal_(self.item_embedding.weight, std=0.05)
        nn.init.zeros_(self.user_bias.weight)
        nn.init.zeros_(self.item_bias.weight)

    def forward(self, users: torch.Tensor, items: torch.Tensor) -> torch.Tensor:
        interaction = (self.user_embedding(users) * self.item_embedding(items)).sum(dim=1)
        return self.global_mean + interaction + self.user_bias(users).squeeze(1) + self.item_bias(items).squeeze(1)


def rating_metrics(predictions: torch.Tensor, targets: torch.Tensor) -> dict[str, float]:
    """Calcula MAE y RMSE sin retener gradientes."""
    errors = predictions.detach() - targets.detach()
    return {
        "mae": float(errors.abs().mean().item()),
        "rmse": float(errors.square().mean().sqrt().item()),
    }
