# Demo sandbox

Open `/demo` or <https://privacy-class-checkin.sociobot.in/demo>.

The first request creates a random in-memory workspace with a 24-hour limit. It contains a 30-learner class named `Tuesday science lab`, 22 present marks, 3 late marks, 5 absent marks, a current sample code, and one sample roster token. The sample supports a learner check-in, keyboard status changes, and a signed encrypted export.

The browser stores only the random workspace ID in `sessionStorage` under `demo:pcc:workspace`. The server keeps the workspace in process memory. Demo requests do not read or write SQLite, teacher keys, real roster tokens, or the product's real-data browser keys.

`Reset demo` deletes the current in-memory workspace and creates a newly seeded one. `Start for real` deletes the sample, clears its session key, and opens teacher setup. The persistent banner reads `Demo — sample data, nothing is saved` while the sample is active.
