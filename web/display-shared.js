/* ES5: shared by the classic phone client and the Mac preview. */
(function (root) {
  var order = ['waiting', 'error', 'running', 'completed', 'unknown', 'idle'];
  function compact(n) {return n>=1000000?(n/1000000).toFixed(1)+'M':n>=1000?(n/1000).toFixed(1)+'k':String(Math.round(n));}
  root.AgentDeckUsageLines = function (usage, now) {
    now = now || Date.now();
    var session = usage && usage.sessionTokens != null ? compact(usage.sessionTokens) + ' Token' : '未提供', cycles = [], i, w, label, minutes, reset, date;
    if (usage && usage.sessionCostUSD != null) session += ' · $' + usage.sessionCostUSD.toFixed(2);
    if (usage && usage.contextPercent != null) session += ' · 上下文 ' + Math.round(usage.contextPercent) + '%';
    if (usage) for (i = 0; i < (usage.windows || []).length; i++) {
      w = usage.windows[i]; if (w.resetsAt <= now) continue;
      label = w.windowMinutes === 300 ? '5h' : w.windowMinutes === 10080 ? '7d' : w.windowMinutes ? (w.windowMinutes < 60 ? w.windowMinutes + 'm' : w.windowMinutes / 60 + 'h') : '额度';
      minutes = Math.max(1, Math.ceil((w.resetsAt - now) / 60000));
      if(minutes < 60) reset=minutes + 'm'; else if(minutes < 1440) reset=Math.ceil(minutes / 60) + 'h'; else reset=Math.ceil(minutes / 1440) + 'd';
      cycles.push(label + ' ' + Math.round(w.usedPercent) + '% · ' + reset + '后重置');
    }
    return [(usage && usage.sessionLabel || '会话') + ' ' + session, (usage && now - usage.updatedAt > 300000 ? '上次额度 ' : '') + (cycles.length ? cycles.join(' / ') : '周期用量未提供')];
  };
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
      for (i = 0; i < tools.length; i++) {
        var candidates = [], recent = null, account = null, active = [], k, totals = 0, cost = 0, allTokens = true, allCosts = true;
        for (j = 0; j < agents.length; j++) {
          c = agents[j]; name = c.subtitle === 'Codex 桌面版' ? 'Codex' : (c.subtitle || 'Agent');
          if (name !== tools[i].name) continue;
          candidates.push(c); if (c.status === 'running' || c.status === 'waiting') active.push(c);
          if (c.usage && (!account || c.usage.updatedAt > account.usage.updatedAt)) account = c;
        }
        if (!account) continue;
        candidates.sort(function (a, b) {return (b.updatedAt || 0) - (a.updatedAt || 0);});
        active.sort(function (a, b) {return (b.updatedAt || 0) - (a.updatedAt || 0);});
        recent = active.length ? active[0] : candidates[0];
        tools[i].usage = {updatedAt: account.usage.updatedAt, windows: account.usage.windows || [], sessionLabel: active.length > 1 ? active.length + ' 个工作会话' : candidates.length > 1 && !active.length ? '最近会话' : recent.usage && recent.usage.sessionScope === 'main' ? '主会话' : '会话'};
        if (active.length > 1) {
          for (k = 0; k < active.length; k++) {if (!active[k].usage || active[k].usage.sessionTokens == null) allTokens = false; else totals += active[k].usage.sessionTokens; if (!active[k].usage || active[k].usage.sessionCostUSD == null) allCosts = false; else cost += active[k].usage.sessionCostUSD;}
          if (allTokens) tools[i].usage.sessionTokens = totals; if (allCosts) tools[i].usage.sessionCostUSD = cost;
        } else if (recent.usage) {tools[i].usage.sessionTokens = recent.usage.sessionTokens; tools[i].usage.sessionCostUSD = recent.usage.sessionCostUSD; tools[i].usage.contextPercent = recent.usage.contextPercent;}
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
