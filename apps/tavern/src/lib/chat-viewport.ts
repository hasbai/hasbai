// iOS keeps the layout viewport behind the keyboard; size the chat to its visible viewport.
export function chatViewport(node: HTMLElement, enabled: boolean) {
  const viewport = window.visualViewport;
  function update() {
    if (!enabled) {
      node.style.removeProperty('--chat-height');
      node.style.removeProperty('--chat-top');
      node.classList.remove('keyboard-open');
      return;
    }
    const visible = viewport && viewport.scale === 1 ? viewport : null;
    node.style.setProperty('--chat-height', `${visible?.height ?? window.innerHeight}px`);
    node.style.setProperty('--chat-top', `${visible?.offsetTop ?? 0}px`);
    node.classList.toggle('keyboard-open', window.innerHeight - (visible?.height ?? window.innerHeight) > 150);
  }
  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  update();
  return {
    update(value: boolean) { enabled = value; update(); },
    destroy() {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    },
  };
}
