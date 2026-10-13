# ADR 0003 — Video baseline: a managed provider holds on Egyptian mobile data, and LiveKit Cloud is the provider for Phase 3

**Status:** accepted · **Date:** 2026-10-13 · **Closes:** T123 (FR-069, SC-015) · **Amends:** nothing; one follow-up for the Phase 3 cycle is named under Consequences

## Context

Every lesson on the platform is a live one-to-one session through a managed
third-party video provider (SRS FR-SESS-1). The SRS names Daily.co or LiveKit
(§10) and asks of the provider only server-minted, per-participant tokens and
lifecycle webhooks (§2.6, §3.7.2). Audio is the teaching modality
(FR-SESS-4): a teacher corrects recitation as it happens, so delay and dropouts
matter more than picture quality.

Nothing had been tried on real hardware. The code holds `VideoPort` and its fake
adapter only, and `docs/ARCHITECTURE.md` names a `daily.adapter.ts` that does not
exist. PLAN.md makes the size of Phase 3, and whether it runs before Phase 4,
depend on this spike.

## How the provider was chosen for the spike

The five providers most compared in 2026 were read against what this platform
needs: one-to-one, audio first, Egyptian mobile networks, an Expo app, and no
paid infrastructure before launch.

| | LiveKit Cloud | Daily | Agora |
| --- | --- | --- | --- |
| Free allowance | 5,000 WebRTC participant minutes a month; a hard cap, so new requests fail instead of being billed | 10,000 participant minutes a month; usage beyond is billed | 10,000 minutes a month; the account is suspended on the second day after the quota is exceeded |
| Servers nearest Egypt | A "Middle East" region group (Saudi Arabia and UAE) | No published region list found | "200+ data centers", locations not published |
| Expo | Official config plugin, development build | Official config plugin, development build | Expo setup through `expo-build-properties`; plugin not confirmed |
| In our documents | SRS §10 | SRS §10, ARCHITECTURE | Not named |
| Leaving it | Open source; can run on our own host behind the same `VideoPort` | Vendor-only | Vendor-only |

Stream and ZEGOCLOUD were not taken further: no independent evaluation was
found. Zoom, Meet and Skype links are excluded by FR-SESS-1. A self-hosted
server (Jitsi, or LiveKit on our own host) needs paid hosting now, which the
owner ruled out for development.

LiveKit Cloud was tried first. Daily stayed the fallback, to be tried the same
way only if LiveKit did badly on Egyptian networks. It did not, so Daily was not
run.

## What was tested

| Item | Value |
| --- | --- |
| Date | 2026-10-13, 21:08 to about 21:30 Cairo time |
| Provider | LiveKit Cloud, free Build plan; project `ejazah-test`, data region EU (Frankfurt), agent observability disabled (we have no agents, and it records audio) |
| Room | `t123-202610131908`, created through the server API (`RoomService/CreateRoom`) with at most 2 participants and a 10-minute empty timeout |
| Tokens | Minted on the developer machine from the API key and secret, HS256, one per participant (`teacher`, `student`), each bound to that room, valid 3 hours. No SDK: `node:crypto` only. The secret never left the machine |
| Client | LiveKit's own web client, `meet.livekit.io/custom`, opened in each phone's browser. Not our app: the app has no session screens before Phase 3 |
| Phones | vivo V60 Lite 5G and realme C53 |
| Network | Etisalat (e&) mobile data on both phones; Wi-Fi switched on and off during the call |
| Length | About 5 minutes in all, as reported by the owner. The dashboard's room-session record shows 2 participants connected together for 2 minutes in one stretch (21:22 to 21:24); the rest of the time was spent across the rejoins below |

## What was observed

| Check | Requirement | Result |
| --- | --- | --- |
| Join with server-minted, room-bound tokens | FR-SESS-3 | Both joined with the token minted for each of them; the room was named inside the token, not chosen by the client |
| Two-way audio, recitation and correction | FR-SESS-4 | Clear, no dropouts. Delay about half a second, judged by ear, not instrumented. The owner judged it normal and acceptable for correction |
| Camera on and off | §3.7.2 | Worked |
| Switch between Wi-Fi and mobile data mid-call | FR-069 | The call continued; no dropout noticed |
| Close the page and reopen it | FR-SESS-9 | Rejoined with the same link |
| Provider-side record of who was connected and when | FR-SESS-9 | The dashboard's session record shows the participant count over time, start time and participant minutes |
| Web client on one phone | — | `meet.livekit.io` crashed with "Application error: a client-side exception" after joining, with the camera already working. After the advice to open it in an up-to-date Chrome, the owner reported both phones working; which change fixed it was not recorded. It is a fault of the sample web page in that phone's browser, not of the provider; the app will use the native SDK |

**Not tested here**, and why it does not block this decision:

- A full 45-minute session, battery and data use, a locked screen and an
  incoming phone call. These are app behaviours of the native SDK, and Phase 3's
  definition of done already requires "a session runs on two physical devices
  over mobile data" in our own app.
- The lifecycle webhooks (FR-SESS-9) reaching our server. They need a public URL
  (a tunnel) and our webhook handler, both Phase 3 work.
- An iPhone. Both phones were Android.
- Daily, which was not needed (above).

## Decision

### D1 — The assumed approach holds; Phase 3 keeps its size and its place

A managed provider over `VideoPort` carries a one-to-one audio-first session on
Egyptian mobile data with acceptable delay and survives a network switch. The
spike does not conclude against the assumed approach, so Phase 3 stays at seven
days and runs before Phase 4, as PLAN.md schedules.

### D2 — LiveKit Cloud is the provider Phase 3 builds against

Phase 3 writes the LiveKit adapter behind `VideoPort`. The reasons, in order:
its free plan is a hard cap, so development can never produce a bill; it has
servers in the Middle East; it has an official Expo config plugin; the SRS
already names it; and being open source, it can later run on our own host
without changing a caller. Daily remains the documented fallback; switching is
one adapter, as ARCHITECTURE §3.2 intends.

## Consequences

- **Follow-up for the Phase 3 cycle:** `docs/ARCHITECTURE.md` names
  `daily.adapter.ts` in the module tree and in the ports section. The Phase 3
  cycle renames it to the LiveKit adapter when it writes the adapter task. This
  task's path is this file only, so the rename is not made here.
- The app needs an Expo development build from the first video task: the
  LiveKit React Native SDK carries native code that Expo Go does not include.
- 5,000 free minutes is about 55 forty-five-minute sessions of two people a
  month: enough for development and testing, not for launch. A paid plan is a
  Phase 6 decision with the hosting.
- Media crosses the border with any provider: none of them was found with a
  server in Egypt. This joins the data-residency question already with counsel
  (research R-19).
- The spike credentials live in `.env.t123` on the developer machine, ignored by
  git (`.env.*`). The test project can be deleted from the LiveKit dashboard
  once Phase 3 creates its own.

## Alternatives rejected

- **Daily first.** Its free minutes run into billing rather than stopping, and
  no Middle East region was found published. It stays the fallback.
- **Agora.** Strong network, but suspension on exceeding the free quota would
  stop live lessons, it is not in our documents, and its Expo setup is manual.
- **Self-hosting now.** Needs a paid server during development.

## References

- LiveKit, [Quotas and limits](https://docs.livekit.io/deploy/admin/quotas-and-limits/)
- LiveKit, [Region pinning](https://docs.livekit.io/deploy/admin/regions/region-pinning)
- LiveKit, [Expo quickstart](https://docs.livekit.io/transport/sdk-platforms/expo/)
- LiveKit Meet, [`app/custom/page.tsx`](https://github.com/livekit-examples/meet/blob/main/app/custom/page.tsx) (the `liveKitUrl` and `token` parameters)
- Daily, [React Native installation](https://docs.daily.co/docs/react-native/installation)
- Agora, [RTC pricing](https://www.agora.io/en/pricing/agora-rtc) and [billing policies](https://docs.agora.io/en/realtime-media/im/reference/billing-policies)
- SRS FR-SESS-1 to FR-SESS-4, FR-SESS-9, §2.6, §3.7.2, §10; PLAN.md, schedule and Phase 3
