// Domain error types. Implemented fully — pure value classes, no business logic.

export class NotImplementedError extends Error {
  constructor(name: string) {
    super(`${name}: not implemented`);
    this.name = 'NotImplementedError';
  }
}

export class AgentCapError extends Error {
  constructor() {
    super('Agent count cap (1000) exceeded for this run');
    this.name = 'AgentCapError';
  }
}

export class BudgetExceededError extends Error {
  constructor(spent: number, total: number) {
    super(`Budget exceeded: spent ${spent} >= total ${total}`);
    this.name = 'BudgetExceededError';
  }
}

export class IllegalTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Illegal state transition: ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export class CatalogNotFoundError extends Error {
  constructor(name: string) {
    super(`Workflow not found in catalog: ${name}`);
    this.name = 'CatalogNotFoundError';
  }
}

export class WorkspaceEscapeError extends Error {
  constructor(path: string) {
    super(`Path escapes run workspace: ${path}`);
    this.name = 'WorkspaceEscapeError';
  }
}
