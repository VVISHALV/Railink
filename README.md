# Railink

Frontend-only web app to analyze IRCTC chart vacancy and compute:

- direct seats for entire journey (single berth)
- stitched seat plan across multiple stations when a single seat is not available end-to-end

## Stack

- Frontend: HTML/CSS/JS
- Data source: IRCTC APIs called directly from browser

## Run

```bash
Open public/index.html in a browser
```

## Input Fields

- Train Number
- Source station code
- Destination station code
- Coach (example: S1)
- Class (example: SL)
- Journey date

## IRCTC APIs Used

1. Train schedule API
2. Train composition API
3. Vacant berth API

## Important Note

IRCTC endpoints can reject or timeout depending on anti-bot checks, headers, network, and runtime conditions. If this happens:

- retry after a short delay
- try alternate dates/coaches
- verify station codes and class
- ensure browser access to IRCTC APIs is allowed from your network and CORS policies

The app is designed with flexible response parsing because IRCTC response fields may vary.
