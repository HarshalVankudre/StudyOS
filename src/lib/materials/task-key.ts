/**
 * Key under which a running study kit's AbortController is registered, so the
 * cancel endpoint can stop it. Scoped by user: nobody can cancel (or probe)
 * someone else's run.
 */
export function studyKitTaskKey(userId: string, generationId: string): string {
  return `study-kit:${userId}:${generationId}`;
}
