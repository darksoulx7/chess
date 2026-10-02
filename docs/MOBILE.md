# Mobile (Phase 9)

One Expo codebase for web, Android and iOS. This sandbox has no emulator or device, so native behaviour is **not run here**. What is verified: `expo export --platform android` and `--platform ios` bundle successfully, the resolved native config is inspected with `expo config --type introspect`, and platform-neutral logic is unit-tested. Everything below marked _device check_ still needs a run on a real device or emulator before release.

## Implemented

| Area                | What                                                                                                                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Haptics             | `expo-haptics`, same event vocabulary as sounds (move, capture, castle/promote, check, end, error). Toggle in Settings (hidden on web), synced with the other preferences. Unit-tested mapping.                            |
| Screen stays on     | `expo-keep-awake` while a game is in progress (local, bot, online).                                                                                                                                                        |
| Android back button | In a local/bot game that has started, back asks "Leave this game?" (those games exist only on the device). Online games are not guarded: leaving does not forfeit and the game can be resumed.                             |
| Keyboard            | Scrollable screens use `KeyboardAvoidingView` (iOS) and `keyboardShouldPersistTaps="handled"`; Android uses `softwareKeyboardLayoutMode: resize`.                                                                          |
| App lifecycle       | Online socket reconnects/pings on foreground (`AppState`), clocks are server-derived, so a backgrounded app catches up from a snapshot. Covered by unit tests with a fake socket and by the web e2e outage test.           |
| Deep links          | URL scheme `chess://`. `chess://join/<CODE>` opens the online hub with the invite code filled in (same route as the web `/join/<CODE>`).                                                                                   |
| Native config       | Audio plugin trimmed to playback only: no microphone permission, no `RECORD_AUDIO`, no foreground-service or background-audio entitlements (verified in the introspected manifest). `ITSAppUsesNonExemptEncryption=false`. |
| Layout              | Safe areas on every screen, board sized from window width/height (phone portrait, tablet, landscape), two-column layout at ≥ 900 px.                                                                                       |

## Not implemented (and why)

- **Push notifications** ("your turn", invites): needs FCM/APNs credentials and a server-side sender; cannot be verified here. The online flow works without them (clocks and snapshots are authoritative).
- **Universal/App Links** (`https://…/join/CODE` opening the app): needs the production domain plus `apple-app-site-association` / `assetlinks.json`. The custom scheme works today.
- **App icon, adaptive icon, splash screen**: no brand assets exist in the repo; Expo defaults apply. Add `icon`, `android.adaptiveIcon`, and `expo-splash-screen` config before store submission.
- **Store builds**: require EAS or local native toolchains and signing credentials (`eas build` is not run here).

## Device checklist

1. Drag and tap input with a finger, including promotion picker and two-finger scroll on the move list.
2. Rotate phone/tablet mid-game; board resizes without losing position.
3. Background the app during an online game for > 40 s, return: connection state shows "Reconnecting…", then the position and clocks are correct.
4. Android back button: local game (confirm), online game (leaves to the previous screen), game-over sheet.
5. Haptics on/off; silent switch behaviour for sounds on iOS.
6. `chess://join/ABCD23` from the OS opens the hub with the code.
7. Keyboard on the sign-in form and the invite-code field does not cover the input.
