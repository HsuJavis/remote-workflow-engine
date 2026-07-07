export const meta = { name: 'snake-sdlc', description: 'Build a browser Snake game via a mini-SDLC (requirements -> design -> implement -> review), every agent on qwen2.5', phases: [{ title: 'Requirements' }, { title: 'Design' }, { title: 'Implement' }, { title: 'Review' }] };

phase('Requirements')
log('gate 1: requirements')
const reqs = await agent(
  'You are a requirements analyst. List exactly 6 concise, testable functional requirements for a browser Snake game (arrow-key control, snake grows on eating food, wall collision ends game, self collision ends game, score display, restart on game over). Output a plain bullet list, no preamble.',
  { model: 'default' }
)

phase('Design')
log('gate 2: design')
const design = await agent(
  'You are a software designer. Given these requirements:\n' + reqs + '\n\nDescribe a minimal single-file HTML5-canvas design in <=8 bullets: grid size, game loop (setInterval tick), snake as an array of cells, food placement, keydown handling, collision checks, score, and game-over/restart. No code yet.',
  { model: 'default' }
)

phase('Implement')
log('gate 3: implement (qwen2.5 writes the whole game)')
const code = await agent(
  'You are a front-end engineer. Write a COMPLETE, self-contained single HTML file for a Snake game implementing this design:\n' + design +
  '\n\nHard rules: (1) one file, HTML+CSS+JS all inline; (2) HTML5 <canvas>; (3) arrow keys move the snake; (4) eating food grows the snake and increments score; (5) hitting a wall or itself ends the game and shows "Game Over" + score; (6) press Space or R to restart; (7) it must run by just opening the file in a browser. Output ONLY the raw HTML file content starting with <!DOCTYPE html>. No markdown code fences, no commentary before or after.',
  { model: 'default' }
)

phase('Review')
log('gate 4: review')
const review = await agent(
  'You are a code reviewer. Here is the start of a Snake game HTML file:\n' + code.slice(0, 2500) +
  '\n\nIn at most 4 bullets, note any obvious bugs, missing features vs a standard Snake game, or risks. Be concise.',
  { model: 'default' }
)

return { requirements: reqs, design, code, review };
