/**
 * Ryan Daily Talk — /rm-magazine/{slug} article renderer.
 *
 * The CMS field `contentRich` arrives as plain Wix rich text (h2 / h3 / p in a
 * fixed order). This script reads that text back into the four Ryan Members
 * lesson steps and rebuilds it as spaced, labelled cards. It only hides the
 * original text after the card version rendered, so a parse failure leaves the
 * page exactly as the CMS sent it.
 *
 * Also hidden here: the contentId / slug lines the template prints under the
 * title. Added to the article: bottom padding so the floating price calculator
 * never covers the last lines.
 */
(function () {
  'use strict';
  if (window.__rmdtBooted) return;
  window.__rmdtBooted = true;

  var ROOT_SEL = '[class*="wixui-rich-content-viewer"]';
  var HERO_KICKER = 'Ryan Daily Talk';
  var HANGUL = /[\uAC00-\uD7A3]/;
  var ID_LINE = /^(SMALL_TALK|BUSINESS)-\d{8}-[a-z0-9-]+$/i;
  var SLUG_LINE = /^(small-talk|business-talk)-\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/i;
  var STAGE_LABELS = {
    'Answer': '한 문장으로 먼저 답하기',
    'Add': '이유나 정보를 한두 문장 더하기',
    'Ask back': '상대에게 되묻기',
    'Conclusion': '핵심 결론부터 말하기',
    'Reason': '근거 기둥 세우기',
    'Detail': '구체적인 디테일 붙이기',
    'Suggestion': '다음 행동 제안하기'
  };

  function clean(value) {
    return String(value == null ? '' : value)
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function nodeText(el) {
    var raw = el.innerText || el.textContent || '';
    return clean(raw);
  }

  function textLines(text) {
    return clean(text).split('\n').map(function (line) { return line.trim(); }).filter(Boolean);
  }

  function make(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function hasHangul(text) { return HANGUL.test(String(text || '')); }

  /** Every leaf text node of the rich content, in document order. */
  function collectNodes(root) {
    var found = root.querySelectorAll('h2,h3,h4,p');
    var out = [];
    for (var i = 0; i < found.length; i += 1) {
      var el = found[i];
      if (el.querySelector('h2,h3,h4,p')) continue;
      var text = nodeText(el);
      if (!text) continue;
      out.push({ tag: el.tagName.toLowerCase(), text: text, lines: textLines(text) });
    }
    return out;
  }

  function splitSections(nodes) {
    var sections = [];
    var current = { step: 0, nodes: [] };
    nodes.forEach(function (node) {
      var match = /^STEP\s*([1-4])\b[^]*$/i.exec(node.text);
      if (match && (node.tag === 'h3' || node.tag === 'h2')) {
        sections.push(current);
        current = { step: Number(match[1]), nodes: [] };
      } else {
        current.nodes.push(node);
      }
    });
    sections.push(current);
    return sections;
  }

  /** "[Small Talk] 주제" -> "Small Talk". */
  function trackFromTitle() {
    var heading = document.querySelector('h1');
    var match = heading ? /^\[([^\]]+)\]/.exec(String(heading.textContent || '').trim()) : null;
    return match ? match[1] : '';
  }

  // --- section parsers -----------------------------------------------------

  function parseHero(nodes) {
    var hero = { titleEn: '', titleKo: '', snackEn: '', snackKo: '' };
    var koSeen = 0;
    nodes.forEach(function (node) {
      if (node.tag === 'h2' && !hero.titleEn) { hero.titleEn = node.text; return; }
      if (node.tag !== 'p') return;
      if (hasHangul(node.text)) {
        koSeen += 1;
        if (koSeen === 1 && !hero.titleKo) hero.titleKo = node.text;
        else if (!hero.snackKo) hero.snackKo = node.text;
      } else if (!hero.snackEn) {
        hero.snackEn = node.text;
      }
    });
    return hero;
  }

  function parseChunks(nodes) {
    var lead = '';
    var chunks = [];
    nodes.forEach(function (node) {
      if (node.lines.length >= 2) {
        chunks.push({ en: node.lines[0], ko: node.lines.slice(1).join(' ') });
      } else if (!lead && node.text.length <= 120) {
        lead = node.text;
      } else if (node.text) {
        chunks.push({ en: '', ko: node.text });
      }
    });
    return { lead: lead, chunks: chunks };
  }

  function parseWordOrder(nodes) {
    var lead = '';
    var rows = [];
    var current = null;
    nodes.forEach(function (node) {
      var text = node.lines[0] || node.text;
      var marked = /^([①②③])\s*(.*)$/.exec(text);
      if (!marked) {
        if (!lead) lead = node.text;
        return;
      }
      var body = marked[2];
      var split = body.split(/\s*[—–]\s*/);
      var label = split.length > 1 ? split[0].trim() : '';
      var value = (split.length > 1 ? split.slice(1).join(' — ') : body).trim();
      var index = '①②③'.indexOf(marked[1]) + 1;
      if (index === 1 || !current) {
        current = { thought: '', order: '', en: '' };
        rows.push(current);
      }
      if (index === 1) current.thought = value;
      else if (index === 2) current.order = value;
      else current.en = value;
      if (label && index === 1) current.thoughtLabel = label;
    });
    return { lead: lead, rows: rows };
  }

  function parseStages(nodes) {
    var lead = '';
    var stages = [];
    var current = null;
    nodes.forEach(function (node) {
      var first = node.lines[0] || '';
      var labelMatch = /^(Answer|Add|Ask back|Conclusion|Reason|Detail|Suggestion)\s*(?:[—–]\s*(.*))?$/.exec(first);
      if (labelMatch) {
        var hint = (labelMatch[2] || '').trim();
        current = {
          label: labelMatch[1],
          hint: hint || STAGE_LABELS[labelMatch[1]] || '',
          en: node.lines[1] || '',
          ko: node.lines[2] || ''
        };
        stages.push(current);
        return;
      }
      if (!current) {
        if (!lead) lead = node.text;
        return;
      }
      if (!current.en) current.en = node.text;
      else if (!current.ko) current.ko = node.text;
    });
    return { lead: lead, stages: stages };
  }

  function parseYourTurn(nodes) {
    var lead = '';
    var dialogueEn = [];
    var dialogueKo = [];
    var swaps = [];
    var mission = null;
    var subhead = '';
    nodes.forEach(function (node) {
      var first = node.lines[0] || '';
      if (/^오늘의\s*미션/.test(node.text)) {
        mission = {
          en: node.lines[1] || '',
          ko: node.lines.slice(2).join(' ') || ''
        };
        return;
      }
      if (/^[AB]\s*:/.test(first)) {
        if (hasHangul(node.text)) dialogueKo = node.lines;
        else dialogueEn = node.lines;
        return;
      }
      var swap = /^\d{1,2}[.)]\s*/.test(first);
      if (swap) {
        swaps.push({
          en: first.replace(/^\d{1,2}[.)]\s*/, ''),
          ko: node.lines.slice(1).join(' ')
        });
        return;
      }
      if (/바꿔\s*말하기/.test(node.text)) { subhead = node.text; return; }
      if (!lead) lead = node.text;
    });
    return { lead: lead, dialogueEn: dialogueEn, dialogueKo: dialogueKo, swaps: swaps, mission: mission, subhead: subhead };
  }

  // --- renderers -----------------------------------------------------------

  function renderHero(hero) {
    var box = make('div', 'rmdt-hero');
    box.appendChild(make('span', 'rmdt-kicker', HERO_KICKER));
    if (hero.titleEn) box.appendChild(make('h2', 'rmdt-title-en', hero.titleEn));
    // The page h1 already prints the Korean topic, so the hero repeats only
    // the English title and keeps the Korean line for pages without an h1.
    if (hero.titleKo && !document.querySelector('h1')) box.appendChild(make('p', 'rmdt-title-ko', hero.titleKo));
    if (hero.snackEn || hero.snackKo) {
      var snack = make('div', 'rmdt-snack');
      if (hero.snackEn) snack.appendChild(make('p', 'rmdt-snack-en', hero.snackEn));
      if (hero.snackKo) snack.appendChild(make('p', 'rmdt-snack-ko', hero.snackKo));
      box.appendChild(snack);
    }
    return box;
  }

  function renderCard(step, name, lead) {
    var card = make('section', 'rmdt-card');
    card.setAttribute('data-step', String(step));
    var head = make('div', 'rmdt-head');
    head.appendChild(make('span', 'rmdt-step', 'STEP ' + step));
    head.appendChild(make('h3', 'rmdt-name', name));
    card.appendChild(head);
    if (lead) card.appendChild(make('p', 'rmdt-lead', lead));
    return card;
  }

  function sectionName(text, fallback) {
    var parts = String(text || '').split('·');
    var name = parts.length > 1 ? parts.slice(1).join('·').trim() : String(text || '').trim();
    return (name || fallback).toUpperCase();
  }

  function renderChunks(section) {
    var data = parseChunks(section.nodes);
    if (!data.chunks.length) return null;
    var card = renderCard(1, sectionName(section.title, 'KEY CHUNKS'), data.lead);
    var list = make('ol', 'rmdt-chunks');
    data.chunks.forEach(function (chunk, index) {
      var item = make('li', 'rmdt-chunk');
      item.appendChild(make('span', 'rmdt-num', String(index + 1)));
      var body = make('div', 'rmdt-chunk-body');
      if (chunk.en) body.appendChild(make('span', 'rmdt-en', chunk.en));
      if (chunk.ko) body.appendChild(make('span', 'rmdt-ko', chunk.ko));
      item.appendChild(body);
      list.appendChild(item);
    });
    card.appendChild(list);
    return card;
  }

  function renderWordOrder(section) {
    var data = parseWordOrder(section.nodes);
    if (!data.rows.length) return null;
    var card = renderCard(2, sectionName(section.title, 'WORD ORDER'), data.lead);
    data.rows.forEach(function (row) {
      var box = make('div', 'rmdt-wo');
      [
        { cls: 'thought', tag: '한국어 생각', value: row.thought },
        { cls: 'order', tag: '영어식 어순', value: row.order },
        { cls: 'final', tag: '영어 문장', value: row.en }
      ].forEach(function (line) {
        if (!line.value) return;
        var wrap = make('div', 'rmdt-wo-line is-' + line.cls);
        wrap.appendChild(make('span', 'rmdt-wo-tag', line.tag));
        wrap.appendChild(make('span', 'rmdt-wo-text', line.value));
        box.appendChild(wrap);
      });
      card.appendChild(box);
    });
    return card;
  }

  function renderStages(section) {
    var data = parseStages(section.nodes);
    if (!data.stages.length) return null;
    var card = renderCard(3, sectionName(section.title, 'AAA'), data.lead);
    data.stages.forEach(function (stage, index) {
      var block = make('div', 'rmdt-stage');
      var label = make('div', 'rmdt-stage-label');
      label.appendChild(make('span', 'rmdt-stage-num', String(index + 1)));
      label.appendChild(make('span', 'rmdt-stage-name', stage.label));
      block.appendChild(label);
      if (stage.hint) block.appendChild(make('span', 'rmdt-stage-hint', stage.hint));
      if (stage.en) block.appendChild(make('p', 'rmdt-stage-en', stage.en));
      if (stage.ko) block.appendChild(make('p', 'rmdt-stage-ko', stage.ko));
      card.appendChild(block);
    });
    return card;
  }

  function renderBubbles(lines, extraClass) {
    var wrap = make('div', 'rmdt-dialogue' + (extraClass ? ' ' + extraClass : ''));
    lines.forEach(function (line) {
      var side = /^B\s*:/.test(line) ? 'is-b' : 'is-a';
      wrap.appendChild(make('div', 'rmdt-bubble ' + side, line.replace(/^[AB]\s*:\s*/, '')));
    });
    return wrap;
  }

  function renderYourTurn(section) {
    var data = parseYourTurn(section.nodes);
    if (!data.dialogueEn.length && !data.swaps.length && !data.mission) return null;
    var card = renderCard(4, sectionName(section.title, 'MODEL & YOUR TURN'), data.lead);
    if (data.dialogueEn.length) card.appendChild(renderBubbles(data.dialogueEn));
    if (data.dialogueKo.length) {
      var toggle = make('details', 'rmdt-ko-toggle');
      toggle.appendChild(make('summary', '', '한글 해석 보기'));
      toggle.appendChild(renderBubbles(data.dialogueKo));
      card.appendChild(toggle);
    }
    if (data.swaps.length) {
      card.appendChild(make('div', 'rmdt-subhead', data.subhead || '내 말로 바꿔 말하기'));
      data.swaps.forEach(function (swap, index) {
        var row = make('div', 'rmdt-swap');
        row.appendChild(make('span', 'rmdt-num', String(index + 1)));
        var body = make('div', 'rmdt-swap-body');
        if (swap.en) body.appendChild(make('span', 'rmdt-en', swap.en));
        if (swap.ko) body.appendChild(make('span', 'rmdt-ko', swap.ko));
        row.appendChild(body);
        card.appendChild(row);
      });
    }
    if (data.mission && data.mission.en) {
      var mission = make('div', 'rmdt-mission');
      mission.appendChild(make('span', 'rmdt-mission-label', '오늘의 미션'));
      mission.appendChild(make('span', 'rmdt-mission-en', data.mission.en));
      if (data.mission.ko) mission.appendChild(make('span', 'rmdt-mission-ko', data.mission.ko));
      card.appendChild(mission);
    }
    return card;
  }

  function buildArticle(root) {
    var nodes = collectNodes(root);
    if (nodes.length < 3) return null;
    var sections = splitSections(nodes);
    var heroNodes = sections[0].step === 0 ? sections[0].nodes : [];
    var lesson = sections.filter(function (section) { return section.step > 0; });
    if (!lesson.length) return null;

    var article = make('div', '', null);
    article.id = 'rmdt-root';
    var hero = parseHero(heroNodes);
    if (hero.titleEn || hero.titleKo || hero.snackEn) article.appendChild(renderHero(hero));

    var rendered = 0;
    lesson.forEach(function (section) {
      var card = null;
      if (section.step === 1) card = renderChunks(section);
      else if (section.step === 2) card = renderWordOrder(section);
      else if (section.step === 3) card = renderStages(section);
      else if (section.step === 4) card = renderYourTurn(section);
      if (card) { article.appendChild(card); rendered += 1; }
    });
    if (!rendered) return null;

    var track = trackFromTitle();
    if (track) article.setAttribute('data-track', track.toLowerCase().replace(/\s+/g, '-'));
    return article;
  }

  // --- page wiring ---------------------------------------------------------

  function hideIdentifierLines() {
    var boxes = document.querySelectorAll('[class*="wixui-rich-text"]');
    for (var i = 0; i < boxes.length; i += 1) {
      var text = clean(boxes[i].textContent);
      if (!text || text.length > 120) continue;
      if (ID_LINE.test(text) || SLUG_LINE.test(text)) {
        boxes[i].style.setProperty('display', 'none', 'important');
      }
    }
  }

  function apply() {
    hideIdentifierLines();
    if (document.getElementById('rmdt-root')) return true;
    var root = document.querySelector(ROOT_SEL);
    if (!root || !root.parentNode) return false;
    var article = null;
    try {
      article = buildArticle(root);
    } catch (error) {
      return false;
    }
    if (!article) return false;
    // Sit right under the page title: the template leaves the height of the old
    // contentId/slug lines as blank space above the article otherwise.
    var heading = document.querySelector('h1');
    var headingBox = heading && (heading.closest('[class*="wixui-rich-text"]') || heading);
    var host = headingBox && headingBox.parentElement;
    if (host && host !== root && host.contains(root) && !root.contains(headingBox)) {
      host.insertBefore(article, headingBox.nextSibling);
    } else {
      root.parentNode.insertBefore(article, root);
    }
    root.style.setProperty('display', 'none', 'important');
    return true;
  }

  var attempts = 0;
  function tick() {
    attempts += 1;
    // Wix re-renders the CMS item once or twice while the page settles, which
    // drops the inserted article. Keep checking (cheap when all is well) so the
    // card version comes back instead of the raw rich text staying on screen.
    if (!document.getElementById('rmdt-root')) {
      try { apply(); } catch (error) { /* keep the CMS text as it is */ }
    } else if (attempts > 120) {
      window.clearInterval(timer);
    }
  }

  var timer = window.setInterval(tick, 350);
  if (document.readyState === 'complete' || document.readyState === 'interactive') tick();
})();
