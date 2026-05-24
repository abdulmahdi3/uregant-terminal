export default {
  app: {
    title: 'urterminal'
  },
  toolbar: {
    addAi: 'Add AI pane',
    addShell: 'Add shell',
    settings: 'Settings',
    perf: 'Perf',
    panes: '{{count}} panes'
  },
  pane: {
    empty: 'Empty pane',
    chooseType: 'Choose a pane type',
    aiPane: 'AI pane',
    shellPane: 'Shell',
    close: 'Close',
    split: 'Split'
  },
  ai: {
    placeholder: 'Send a message…',
    send: 'Send',
    stop: 'Stop',
    model: 'Model',
    provider: 'Provider',
    noKey: 'No API key set for {{provider}}. Open Settings to add one.',
    thinking: 'Generating…'
  },
  settings: {
    title: 'Settings',
    close: 'Close',
    providers: 'AI Providers',
    apiKey: 'API key',
    baseUrl: 'Base URL',
    save: 'Save',
    saved: 'Saved',
    test: 'Test',
    testing: 'Testing…',
    testOk: 'Key works',
    testFail: 'Failed',
    keySet: 'Key set',
    keyNotSet: 'Not set',
    clear: 'Clear',
    telegram: 'Telegram',
    telegramToken: 'Bot token',
    telegramDefaultChat: 'Default chat id',
    telegramStatus: 'Status',
    telegramRunning: 'Running',
    telegramStopped: 'Stopped',
    restart: 'Restart bot',
    defaults: 'Defaults',
    defaultProvider: 'Default provider',
    defaultModel: 'Default model',
    appearance: 'Appearance',
    theme: 'Theme',
    dark: 'Dark',
    light: 'Light',
    language: 'Language'
  },
  telegram: {
    link: 'Link to Telegram',
    linked: 'Forwarding to chat {{chatId}}',
    unlink: 'Unlink',
    chatIdPrompt: 'Telegram chat id to forward this pane to:'
  },
  perf: {
    title: 'Performance',
    ram: 'Main RSS',
    heap: 'Heap',
    panes: 'Active panes',
    streams: 'Streams/sec'
  }
}
