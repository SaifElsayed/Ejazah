# Copy pass — remove backend rules from what users read

S = `C:/Users/amrkn/AppData/Local/Temp/claude/D--Ejazah/c3bd6a6a-9b5f-4684-afd6-90b8324af08a/scratchpad`
Read `S/BRIEF.md` (build rules) first. Every board is `S/frags/<Name>.html`; build with
`node tools/rebuild.js <Name>` (it takes the title and size from canvas.json), then `node tools/lint.js <Name>` must
say `lint: clean` and `sh tools/check.sh <Name>` must say `RESULT {}`. Never edit components.css, tokens, icons,
tools/, canvas.json or boards not in your list. Do not take screenshots unless check fails (memory on this machine is
limited); delete any PNG you make.

## The owner's complaint
Screens explain how the system works. That belongs in the backend rules (SRS) and in the Terms, not on screens.
Think like the copy in apps people already use — Uber/Careem, Talabat, Airbnb, Preply/italki, Tarteel, Apple Pay —
where a screen says what you can do and what happens to you, in as few words as possible, and never how it works.

## Rules
1. **Remove** any text that describes mechanics: slot holds and grace periods, gateway orders or expiry mechanics,
   webhooks/servers/confirmation from the server, how money is settled or routed, commission math, platform not
   holding money, attendance thresholds and percentages, join-window math, "evaluated automatically after the end",
   counted/not-counted explanations beyond a status word, retention/purge rules, audit logs, compensation-case
   mechanics, data-protection/encryption claims, "generated from the platform template", immutable snapshots,
   verification tokens, why a rule exists, notes about what the admin can or cannot do internally.
2. **Keep only what a person needs to make the decision in front of them**, as one short plain sentence, at the
   point of decision. Examples of what may stay: a countdown «أكمل الدفع خلال 8:12»; on a cancel request «إن لم يرد
   المعلم قبل الموعد تبقى الجلسة قائمة»; a deadline as a date «يمكنك فتح نزاع حتى السبت 6:45 م»; that a camera is
   optional; that gender cannot be changed later (it is a decision now).
3. Prefer **no helper text at all**. Delete explanatory footers, captions and banners that only reassure or explain.
   Never leave a screen without its primary action or its key information.
4. Status words stay as they are (جارٍ، تمت، غياب المعلم…). Do not explain them in sentences.
5. Do not change structure, links, data, names, dates or numbers that are data (prices, counts). Only text, or remove
   a helper element. If removing a banner leaves an empty wrapper, remove the wrapper.
6. Arabic stays natural and short. Female forms for female people.

## Report (short)
For each board you changed: before → after (or "removed: …"). Boards you left as they are. Anything you were unsure about.
