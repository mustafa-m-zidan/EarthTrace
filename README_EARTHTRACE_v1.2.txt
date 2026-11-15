EARTHTRACE — COSMIC / HOVER REFRESH

This package contains the updated EarthTrace project.

WHAT CHANGED
- Added a subtle celestial layer behind the opening planetary system: extra stars, small planets, asteroid details, a satellite and a line-art rocket.
- Increased the number of independently animated particles around the globe.
- Fixed the signal hover behaviour so the orbital animation does not freeze after leaving a signal.
- Moved the small signal explanation away from the lower coordinate/caption labels.
- Added a restrained cursor-following highlight to the Data Detective and Guided Studies cards only.
- Added small hover-triggered rotations to selected decorative rings and study map details.
- Preserved the site's dark navy, cyan and amber palette.

RUNNING ON WINDOWS
1. Extract this ZIP into a new folder.
2. Open that extracted folder — the one containing main.py and requirements.txt.
3. In that folder, open Command Prompt / Terminal and run:
   py -m venv .venv
   .venv\Scripts\python.exe -m pip install -r requirements.txt
   .venv\Scripts\python.exe -m uvicorn main:app --reload
4. Open http://127.0.0.1:8000 in your browser.

IMPORTANT
Run the uvicorn command from the same folder that directly contains main.py.
The browser preview in the editing environment blocked local browser navigation, so the final QA here covers JavaScript syntax, CSS parsing, HTML parsing and FastAPI import; it is not a claim of full cross-browser visual testing.
