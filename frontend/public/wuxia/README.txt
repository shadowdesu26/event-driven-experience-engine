Drop your Wuxia media assets here. The middleware scans this folder at request
time (mtime-cached) and matches files by event keyword, so files can be renamed
or swapped at runtime without editing backend code.

Keyword matching is case-insensitive; the most specific keyword wins:
  game_start / spin_result / win_streak / near_win / big_win /
  jackpot / no_win / win (bare "win" maps to BIG_WIN)

Optional multiplier tier suffixes, auto-selected by Win/Bet:
  <name>_10x.mp4   -> picked when Win/Bet >= 10
  <name>_25x.mp4   -> picked when Win/Bet >= 25
  <name>_50x.mp4   -> picked when Win/Bet >= 50
  (highest eligible tier wins; falls back to the base file when absent)

Current base assets:
  wuxia_game_start.mp4    <- GAME_START
  wuxia_spin_result.mp4   <- SPIN_RESULT
  wuxia_near_win.mp4      <- NEAR_WIN
  wuxia_bonus_trigger.mp4 <- BONUS_TRIGGER
  wuxia_big_win.mp4       <- BIG_WIN
  wuxia_jackpot.mp4       <- JACKPOT
  WUXIA_NO_WIN.mp4        <- NO_WIN (case-insensitive)
  wuxia_win_streak.mp4    <- WIN_STREAK

Files in this folder are served at /wuxia/<filename>, e.g. /wuxia/wuxia_near_win.mp4
Inspect the live scanned catalog at GET /api/assets?theme=wuxia
