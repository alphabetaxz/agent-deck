/* ES5: shared by the classic phone client and the Mac preview. */
(function (root) {
  var order = ['waiting', 'error', 'running', 'completed', 'unknown', 'idle'];
  root.AgentDeckDisplayCards = function (cards, plugins) {
    plugins = plugins || [];
    var result = [], agents = [], tools = [], agentPlugin, i, j, c, name, status, found, overall;
    for (i = 0; i < cards.length; i++) {
      c = cards[i];
      if (c.pluginId === 'agents') agents.push(c); else result.push(c);
    }
    for (i = 0; i < plugins.length; i++) if (plugins[i].id === 'agents') agentPlugin = plugins[i];
    if (agents.length || agentPlugin) {
      for (i = 0; i < agents.length; i++) {
        c = agents[i]; name = c.subtitle === 'Codex 桌面版' ? 'Codex' : (c.subtitle || 'Agent');
        status = c.pluginStatus === 'running' ? c.status : 'error'; found = false;
        for (j = 0; j < tools.length; j++) if (tools[j].name === name) {
          if (order.indexOf(status) < order.indexOf(tools[j].status)) tools[j].status = status;
          found = true; break;
        }
        if (!found) tools.push({name: name, status: status});
      }
      overall = agentPlugin && agentPlugin.status === 'running' ? 'idle' : 'unknown';
      for (i = order.length - 1; i >= 0; i--) for (j = 0; j < tools.length; j++) if (tools[j].status === order[i]) overall = order[i];
      result.unshift({id: 'agent-summary', pluginId: 'agents', type: 'agent-summary', title: 'Agent', status: overall, tools: tools, pluginStatus: agentPlugin ? agentPlugin.status : (agents[0] && agents[0].pluginStatus || 'running')});
    }
    for (i = 0; i < plugins.length; i++) {
      c = plugins[i]; found = false;
      for (j = 0; j < result.length; j++) if (result[j].pluginId === c.id) found = true;
      if (c.id !== 'agents' && !found) result.push({id: c.id + '-empty', pluginId: c.id, type: 'text', title: c.name || c.id, text: c.status === 'starting' ? '正在加载' : '暂无数据', pluginStatus: c.status, updatedAt: Date.now()});
    }
    return result;
  };
}(typeof window !== 'undefined' ? window : globalThis));
