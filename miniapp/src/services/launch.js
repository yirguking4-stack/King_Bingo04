// Where the Mini App was opened from. The bot's menu buttons open it with ?tab=...
// (e.g. ?tab=deposit, ?tab=withdraw, ?tab=transactions, ?tab=games), so a player lands straight on the page they tapped.
const params = new URLSearchParams(window.location.search);

export const LAUNCH_TABS = ['games', 'dama', 'lobby', 'wallet', 'deposit', 'withdraw', 'transactions', 'profile', 'support', 'appointments'];

function initialTab() {
  const tab = params.get('tab');
  // older links: ?tab=wallet&mode=deposit|withdraw|transactions
  if (tab === 'wallet' && ['deposit', 'withdraw', 'transactions'].includes(params.get('mode'))) return params.get('mode');
  return LAUNCH_TABS.includes(tab) ? tab : null;
}

export const launch = {
  tab: initialTab(),
};
