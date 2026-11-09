import { endpoints } from "@/api/endpoints";
import type { InteractionType } from "@/api/types";

const sent = new Set<string>();

export function recordInteraction(
  bookId: number,
  interactionType: InteractionType,
): void {
  const key = `${interactionType}:${bookId}`;
  if (sent.has(key)) return;
  sent.add(key);
  void endpoints.personalization
    .addInteraction({ book_id: bookId, interaction_type: interactionType })
    .catch(() => {
      // Interaction telemetry is best effort; never interrupt reading.
    });
}

export function resetInteractionCache(): void {
  sent.clear();
}
