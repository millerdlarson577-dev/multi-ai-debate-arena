  {
    id: 'claude',
    name: 'Claude',
    vendor: 'Anthropic',
    type: 'anthropic',
    defaultBase: 'https://api.anthropic.com',
    defaultModel: 'claude-haiku-4-5',
    envKey: 'ANTHROPIC_API_KEY',
    persona: '严谨审慎派：擅长挑出逻辑漏洞、前提假设与潜在风险，措辞克制。',
    color: '#d97757',
    disabled: true, // 当前网络/账号下 403 不可用，先从参与列表移除；恢复时删除本行即可
  },