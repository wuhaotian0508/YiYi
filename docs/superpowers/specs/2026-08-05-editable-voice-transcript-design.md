# Editable Voice Transcript Design

## Goal

After YiYi produces an outfit recommendation, show the user's latest voice transcript in an editable card. The user can correct the text and confirm with a checkmark to regenerate the recommendation from the corrected request.

## Interaction

1. The result view shows the latest finalized user transcript below the outfit explanation.
2. A pencil button changes the transcript card into a multiline text field.
3. A checkmark saves the edited text, exits edit mode, and runs the existing initial recommendation flow with the edited request.
4. A cancel button exits edit mode without changing the current outfit or transcript.
5. Empty or whitespace-only edits are rejected in place and do not trigger a recommendation.

## Architecture

The existing `TodayPage` remains the owner of recommendation state and invokes its existing recommendation decision pipeline. A focused `EditableVoiceTranscript` component owns only edit-mode state and emits `onCommit(text)` / `onCancel()` callbacks. The latest finalized user transcript remains sourced from `voiceSessionCoordinator`; no audio is persisted or uploaded.

## Presentation

The card uses the existing YiYi light, rounded-surface visual language. It includes a listening label, transcript text, pencil/check/cancel controls, and a deterministic decorative waveform. Controls are keyboard accessible with explicit labels and the text area is constrained to the card width.

## Error handling

- Blank edits remain in edit mode and show a short validation message.
- Recommendation failures reuse the existing voice/recommendation recovery state and leave the last valid outfit intact.
- The original transcript remains available if the user cancels.

## Verification

- Unit test the component's view/edit/commit/cancel/blank-edit behavior.
- Run focused Vitest, ESLint, and the production build.
- Verify the live result page shows the card and that committing an edit invokes the recommendation callback.
