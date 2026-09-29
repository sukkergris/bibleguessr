// Tag filter for the docs index's feature grid.
//
// Progressive enhancement: the filter markup ships `hidden`, and this script
// reveals it only once it has built the buttons, so without JavaScript every
// card is simply shown. The tags are read from the cards themselves, so a new
// page only needs its `.tag` spans — there is no separate list to maintain.
//
// Single-select: pressing a tag shows only the cards carrying it; pressing it
// again, or "All", shows every card. State is exposed with aria-pressed (not
// color alone), and each change is announced once through the status region.

(() => {
  const FILTER_SELECTOR = '[data-tag-filter]';
  const GRID_SELECTOR = '[data-tag-filter-grid]';
  const STATUS_SELECTOR = '[data-tag-filter-status]';
  const CARD_SELECTOR = '.feature-card';
  const TAG_SELECTOR = '.card-tags .tag';
  const BUTTON_CLASS = 'tag-filter-button';
  const CHECK_CLASS = 'tag-filter-check';
  const CHECK_MARK = '\u2713';
  const ALL_LABEL = 'All';

  /** @typedef {{ kind: 'all' } | { kind: 'tag', tag: string }} FilterState */

  /** @type {FilterState} */
  const SHOW_ALL = { kind: 'all' };

  const filter = document.querySelector(FILTER_SELECTOR);
  const grid = document.querySelector(GRID_SELECTOR);
  const status = document.querySelector(STATUS_SELECTOR);
  if (!filter || !grid || !status) return;

  const cards = Array.from(grid.querySelectorAll(CARD_SELECTOR)).map((card) => ({
    element: card,
    tags: new Set(
      Array.from(card.querySelectorAll(TAG_SELECTOR), (tag) => tag.textContent.trim()),
    ),
  }));

  const tagCounts = new Map();
  for (const card of cards) {
    for (const tag of card.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  const tags = Array.from(tagCounts.keys()).sort((a, b) => a.localeCompare(b));

  /** @param {FilterState} state */
  const matches = (state, card) => state.kind === 'all' || card.tags.has(state.tag);

  /** @param {FilterState} state @param {FilterState} other */
  const sameState = (state, other) =>
    state.kind === other.kind && (state.kind === 'all' || state.tag === other.tag);

  const makeButton = (label, count, state) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    // The check mark is a visual cue only; aria-pressed already carries the
    // state for assistive technology, so it is hidden from the accessible name.
    const check = document.createElement('span');
    check.className = CHECK_CLASS;
    check.setAttribute('aria-hidden', 'true');
    check.textContent = CHECK_MARK;
    button.append(check, `${label} (${count})`);
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      const pressedAgain = state.kind === 'tag' && sameState(current, state);
      apply(pressedAgain ? SHOW_ALL : state, { announce: true });
    });
    return { button, state };
  };

  const buttons = [
    makeButton(ALL_LABEL, cards.length, SHOW_ALL),
    ...tags.map((tag) => makeButton(tag, tagCounts.get(tag), { kind: 'tag', tag })),
  ];

  /** @type {FilterState} */
  let current = SHOW_ALL;

  /** @param {FilterState} state */
  const describe = (state, shown) =>
    state.kind === 'all'
      ? `Showing all ${cards.length} features.`
      : `Showing ${shown} of ${cards.length} features tagged ${state.tag}.`;

  /** @param {FilterState} state */
  function apply(state, { announce }) {
    current = state;
    let shown = 0;
    for (const card of cards) {
      const visible = matches(state, card);
      card.element.hidden = !visible;
      if (visible) shown += 1;
    }
    for (const { button, state: buttonState } of buttons) {
      button.setAttribute('aria-pressed', String(sameState(state, buttonState)));
    }
    // Only a user action updates the live region, so loading the page
    // announces nothing.
    if (announce) status.textContent = describe(state, shown);
  }

  const list = filter.querySelector('[data-tag-filter-buttons]');
  for (const { button } of buttons) list.append(button);

  apply(SHOW_ALL, { announce: false });
  filter.hidden = false;
})();
