# Requirements — Console Snake Game (002)

### REQ-001 — snake moves and is controlled by the player
- **status:** reviewed
- **traces:** —
- **acceptance:** Given the game is running When the player presses an arrow key or WASD Then the snake's direction changes accordingly and the snake advances one cell per tick in that direction; a 180° reverse into itself is ignored.
- **iter:** v1

### REQ-002 — eating food grows the snake and scores
- **status:** reviewed
- **traces:** —
- **acceptance:** Given the snake head reaches the food cell When the tick resolves Then the snake length increases by one, the score increases by one, and a new food appears at a random empty cell.
- **iter:** v1

### REQ-003 — collision ends the game
- **status:** reviewed
- **traces:** —
- **acceptance:** Given the snake head moves into a wall or into its own body When the tick resolves Then the game ends and the final score is shown; pressing q quits at any time.
- **iter:** v1
