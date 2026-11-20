/**
 * Ryan Daily Talk — /rm-magazine/{slug} article renderer.
 *
 * The CMS field `contentRich` arrives as plain Wix rich text (h2 / h3 / p in a
 * fixed order). This script reads that text back into the Ryan Members lesson
 * steps and rebuilds it as spaced, labelled cards. It only hides the original
 * text after the card version rendered, so a parse failure leaves the page
 * exactly as the CMS sent it.
 *
 * Two lesson shapes live on the site right now:
 *   - five steps (2026-11-20 onward): KEY WORDS -> KOREAN SENTENCES ->
 *     ENGLISH WORD ORDER (누가 / 한다 / 무엇을 / 어디서 / 언제 chips) ->
 *     ENGLISH SENTENCES -> step 5, which is AAA IN ACTION (Answer / Add / Ask)
 *     for small talk and MESSAGE HOUSE (Conclusion / Reason / Detail /
 *     Suggestion) for business talk,
 *   - four steps (articles published before that): KEY CHUNKS -> WORD ORDER ->
 *     AAA / MESSAGE HOUSE -> MODEL & YOUR TURN.
 * Whichever the text carries is what gets drawn; nothing is guessed.
 *
 * Also hidden here: the contentId / slug lines the template prints under the
 * title. Added to the article: bottom padding so the floating price calculator
 * never covers the last lines, and one closing CTA card (Ryan Daily Talk free
 * sign-up / track change) sitting under the last step card.
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

  // STEP n: the label printed in the head, and the Korean line under it.
  var STEP_INFO = {
    1: { name: 'KEY WORDS', ko: '오늘의 단어 3개' },
    2: { name: 'KOREAN SENTENCES', ko: '그 단어로 만든 한국어 문장' },
    3: { name: 'ENGLISH WORD ORDER', ko: '영어 어순으로 재정렬' },
    4: { name: 'ENGLISH SENTENCES', ko: '통번역한 영어 문장' },
    5: { name: 'AAA IN ACTION', ko: '실제 대화 3문장' }
  };
  // STEP 5 for a business card: the same card slot, a different structure.
  var MESSAGE_HOUSE_INFO = { name: 'MESSAGE HOUSE', ko: '결론 → 근거 → 디테일' };
  var MARKS = '①②③④';
  var ROLE_LABELS = { '누가': '누가', '한다': '한다', '무엇을': '무엇을', '어디서': '어디서', '언제': '언제', '어떻게': '어떻게' };
  var CTA_LINKS = {
    signup: 'https://www.ryanmembers.com/?dailytalk=1',
    kakao: 'https://pf.kakao.com/_xkFxexfX/friend'
  };
  var STAGE_LABELS = {
    'Answer': '한 문장으로 먼저 답하기',
    'Add': '이유나 정보를 한두 문장 더하기',
    'Ask back': '상대에게 되묻기',
    'Conclusion': '핵심 결론부터 말하기',
    'Reason': '근거 기둥 세우기',
    'Detail': '구체적인 디테일 붙이기',
    'Suggestion': '다음 행동 제안하기'
  };
  var AAA_HINTS = {
    'Answer': '한 문장으로 먼저 답하기',
    'Add': '이유나 디테일을 한 문장 더하기',
    'Ask': '상대에게 되묻기',
    'Conclusion': '핵심 결론부터 말하기',
    'Reason': '근거 기둥 세우기',
    'Detail': '구체적인 디테일 붙이기',
    'Suggestion': '다음 행동 제안하기'
  };
  var MESSAGE_HOUSE_LABELS = ['Conclusion', 'Reason', 'Detail', 'Suggestion'];

  function clean(value) {
    return String(value == null ? '' : value)
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function nodeText(el) {
    // Wix renders the CMS line breaks as real newlines inside one <span>, and
    // its rich text keeps white-space: pre-wrap, so innerText carries them.
    // Should a template ever drop pre-wrap, textContent still has the newline:
    // prefer it then, or "warm coffee / 따뜻한 커피" would read as one line.
    var rendered = clean(el.innerText || '');
    var raw = clean(el.textContent || '');
    if (raw.indexOf('\n') !== -1 && rendered.indexOf('\n') === -1) return raw;
    return rendered || raw;
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
    var current = { step: 0, title: '', nodes: [] };
    nodes.forEach(function (node) {
      var match = /^STEP\s*([1-6])\b[^]*$/i.exec(node.text);
      if (match && (node.tag === 'h3' || node.tag === 'h2')) {
        sections.push(current);
        current = { step: Number(match[1]), title: node.text, nodes: [] };
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

  // --- section parsers (five steps) ---------------------------------------

  /** STEP 1: "<word>\n<meaning>" paragraphs; the single-line one is the lead. */
  function parseWords(nodes) {
    var lead = '';
    var words = [];
    nodes.forEach(function (node) {
      if (node.lines.length >= 2) {
        words.push({ en: node.lines[0], ko: node.lines.slice(1).join(' ') });
      } else if (!lead) {
        lead = node.text;
      } else if (!hasHangul(node.text)) {
        words.push({ en: node.text, ko: '' });
      }
    });
    return { lead: lead, words: words };
  }

  /** STEP 2 and STEP 4: "① sentence" paragraphs. */
  function parseNumbered(nodes) {
    var lead = '';
    var rows = [];
    nodes.forEach(function (node) {
      var first = node.lines[0] || '';
      var marked = /^([①②③④]|\d[.)])\s*(.*)$/.exec(first);
      if (marked) {
        rows.push({
          index: MARKS.indexOf(marked[1]) >= 0 ? MARKS.indexOf(marked[1]) : Number(String(marked[1]).replace(/\D/g, '')) - 1,
          text: marked[2].trim()
        });
        return;
      }
      if (!lead) lead = node.text;
    });
    return { lead: lead, rows: rows };
  }

  /** STEP 3: "① 누가: 나는 / 한다: 마셨다 / …" — one row of role chips. */
  function parseOrder(nodes) {
    var lead = '';
    var rows = [];
    nodes.forEach(function (node) {
      var first = node.lines[0] || '';
      var marked = /^([①②③④]|\d[.)])\s*(.*)$/.exec(first);
      if (!marked) {
        if (!lead) lead = node.text;
        return;
      }
      var index = MARKS.indexOf(marked[1]) >= 0 ? MARKS.indexOf(marked[1]) : Number(String(marked[1]).replace(/\D/g, '')) - 1;
      var pieces = marked[2].split(/\s*\/\s*/).map(function (part) {
        var piece = /^(누가|한다|무엇을|어디서|언제|어떻게)\s*[:：]\s*(.+)$/.exec(part.trim());
        if (piece) return { role: piece[1], text: piece[2].trim() };
        return { role: '', text: part.trim() };
      }).filter(function (piece) { return piece.text; });
      if (pieces.length) rows.push({ index: index, pieces: pieces });
    });
    return { lead: lead, rows: rows };
  }

  /**
   * STEP 5: "Answer — hint\n<en>\n<ko>" paragraphs plus the picked sentence.
   * Business cards use the same paragraph shape with the Message House labels.
   */
  function parseAaa(nodes) {
    var first = { lead: '', pick: 0, steps: [], messageHouse: false };
    var current = null;
    nodes.forEach(function (node) {
      var head = node.lines[0] || '';
      var label = /^(Answer|Add|Ask(?:\s*back)?|Conclusion|Reason|Detail|Suggestion)\s*(?:[—–-]\s*(.*))?$/i.exec(head);
      if (label) {
        var name = /^ask/i.test(label[1]) ? 'Ask' : label[1].charAt(0).toUpperCase() + label[1].slice(1).toLowerCase();
        if (MESSAGE_HOUSE_LABELS.indexOf(name) !== -1) first.messageHouse = true;
        current = {
          label: name,
          hint: (label[2] || '').trim() || AAA_HINTS[name] || '',
          en: node.lines[1] || '',
          ko: node.lines.slice(2).join(' ') || ''
        };
        first.steps.push(current);
        return;
      }
      if (!first.lead) {
        first.lead = node.text;
        var picked = /문장\s*([①②③④])/.exec(node.text);
        // 1-based: the mark the lead names (① -> 1).
        if (picked) first.pick = MARKS.indexOf(picked[1]) + 1;
      }
    });
    return first;
  }

  // --- section parsers (four steps, published before 2026-11-20) ----------

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
      var value = (split.length > 1 ? split.slice(1).join(' — ') : body).trim();
      var index = '①②③'.indexOf(marked[1]) + 1;
      if (index === 1 || !current) {
        current = { thought: '', order: '', en: '' };
        rows.push(current);
      }
      if (index === 1) current.thought = value;
      else if (index === 2) current.order = value;
      else current.en = value;
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
        current = {
          label: labelMatch[1],
          hint: (labelMatch[2] || '').trim() || STAGE_LABELS[labelMatch[1]] || '',
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

  function renderCard(step, lead, info) {
    var meta = info || STEP_INFO[step] || { name: '', ko: '' };
    var card = make('section', 'rmdt-card');
    card.setAttribute('data-step', String(step));
    var head = make('div', 'rmdt-head');
    head.appendChild(make('span', 'rmdt-step', 'STEP ' + step));
    var names = make('div', 'rmdt-names');
    names.appendChild(make('h3', 'rmdt-name', meta.name));
    if (meta.ko) names.appendChild(make('span', 'rmdt-sub', meta.ko));
    head.appendChild(names);
    card.appendChild(head);
    if (lead) card.appendChild(make('p', 'rmdt-lead', lead));
    return card;
  }

  /** "STEP 2 · WORD ORDER" -> "WORD ORDER" (legacy titles). */
  function sectionName(title, fallback) {
    var parts = String(title || '').split('·');
    var name = parts.length > 1 ? parts.slice(1).join('·').trim() : String(title || '').trim();
    return (name || fallback).toUpperCase();
  }

  function markBadge(index) {
    return make('span', 'rmdt-mark', MARKS.charAt(index) || String(index + 1));
  }

  /** STEP 1 — three words, each with its Korean meaning. */
  function renderWords(data) {
    if (!data.words.length) return null;
    var card = renderCard(1, data.lead);
    var list = make('ul', 'rmdt-words');
    data.words.forEach(function (word, index) {
      var item = make('li', 'rmdt-word');
      item.appendChild(make('span', 'rmdt-word-num', String(index + 1)));
      var body = make('div', 'rmdt-word-body');
      body.appendChild(make('span', 'rmdt-word-en', word.en));
      if (word.ko) body.appendChild(make('span', 'rmdt-word-ko', word.ko));
      item.appendChild(body);
      list.appendChild(item);
    });
    card.appendChild(list);
    return card;
  }

  /** STEP 2 / STEP 4 — numbered sentences, aligned by the same mark. */
  function renderSentences(data, step, rowClass, textClass) {
    if (!data.rows.length) return null;
    var card = renderCard(step, data.lead);
    var list = make('ol', rowClass);
    data.rows.forEach(function (row) {
      var item = make('li', rowClass + '-row');
      item.appendChild(markBadge(row.index >= 0 ? row.index : list.children.length));
      item.appendChild(make('span', textClass, row.text));
      list.appendChild(item);
    });
    card.appendChild(list);
    return card;
  }

  /** STEP 3 — the Korean pieces of each sentence as role chips, in English order. */
  function renderOrder(data) {
    if (!data.rows.length) return null;
    var card = renderCard(3, data.lead);
    var list = make('div', 'rmdt-orders');
    data.rows.forEach(function (row, rowIndex) {
      var box = make('div', 'rmdt-order');
      box.appendChild(markBadge(row.index >= 0 ? row.index : rowIndex));
      var chips = make('div', 'rmdt-chips');
      row.pieces.forEach(function (piece, pieceIndex) {
        // The slash travels with the chip after it, so a wrapped line never
        // ends on a dangling "/".
        var unit = make('span', 'rmdt-chip-unit');
        if (pieceIndex) unit.appendChild(make('span', 'rmdt-chip-sep', '/'));
        var chip = make('span', 'rmdt-chip');
        if (piece.role) chip.appendChild(make('span', 'rmdt-chip-role', ROLE_LABELS[piece.role] || piece.role));
        chip.appendChild(make('span', 'rmdt-chip-text', piece.text));
        unit.appendChild(chip);
        chips.appendChild(unit);
      });
      box.appendChild(chips);
      list.appendChild(box);
    });
    card.appendChild(list);
    return card;
  }

  /** STEP 5 — the picked sentence, then Answer / Add / Ask or the Message House. */
  function renderAaa(data, context, info) {
    if (!data.steps.length) return null;
    var card = renderCard(5, data.lead, info || (data.messageHouse ? MESSAGE_HOUSE_INFO : STEP_INFO[5]));
    if (data.messageHouse) card.classList.add('is-message-house');
    var picked = null;
    var index = data.pick > 0 ? data.pick - 1 : -1;
    if (index >= 0 && context) {
      var koreanRow = context.korean.rows.filter(function (row) { return row.index === index; })[0];
      var englishRow = context.english.rows.filter(function (row) { return row.index === index; })[0];
      if (koreanRow || englishRow) {
        picked = make('div', 'rmdt-pick');
        picked.appendChild(make('span', 'rmdt-pick-label', '오늘 고른 문장 ' + MARKS.charAt(index)));
        if (koreanRow) picked.appendChild(make('span', 'rmdt-pick-ko', koreanRow.text));
        if (englishRow) picked.appendChild(make('span', 'rmdt-pick-en', englishRow.text));
        card.appendChild(picked);
      }
    }

    var list = make('div', 'rmdt-aaa');
    data.steps.forEach(function (step, stepIndex) {
      var block = make('div', 'rmdt-aaa-block');
      block.setAttribute('data-role', step.label.toLowerCase());
      var head = make('div', 'rmdt-aaa-head');
      head.appendChild(make('span', 'rmdt-aaa-num', String(stepIndex + 1)));
      head.appendChild(make('span', 'rmdt-aaa-badge', step.label.toUpperCase()));
      if (step.hint) head.appendChild(make('span', 'rmdt-aaa-hint', step.hint));
      block.appendChild(head);
      if (step.en) block.appendChild(make('p', 'rmdt-aaa-en', step.en));
      if (step.ko) block.appendChild(make('p', 'rmdt-aaa-ko', step.ko));
      list.appendChild(block);
    });
    card.appendChild(list);
    return card;
  }

  // --- four-step renderers (kept for articles published before 2026-11-20) -

  function renderChunks(section) {
    var data = parseChunks(section.nodes);
    if (!data.chunks.length) return null;
    var card = renderCard(1, data.lead, { name: sectionName(section.title, 'KEY CHUNKS'), ko: '' });
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
    var card = renderCard(2, data.lead, { name: sectionName(section.title, 'WORD ORDER'), ko: '' });
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
    var card = renderCard(3, data.lead, { name: sectionName(section.title, 'AAA'), ko: '' });
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
    var card = renderCard(4, data.lead, { name: sectionName(section.title, 'MODEL & YOUR TURN'), ko: '' });
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

  // --- closing CTA ---------------------------------------------------------

  function renderCta() {
    var box = make('aside', 'rmdt-cta');
    box.setAttribute('aria-label', 'Ryan Daily Talk 무료 신청');
    box.appendChild(make('span', 'rmdt-cta-kicker', 'Ryan Daily Talk'));
    box.appendChild(make('p', 'rmdt-cta-title', '매일 아침, 영어 한 조각.'));
    box.appendChild(make('p', 'rmdt-cta-copy', '오늘 같은 레슨을 평일 아침 카카오톡으로 무료로 보내드립니다.'));

    var button = make('a', 'rmdt-cta-btn', null);
    button.setAttribute('href', CTA_LINKS.signup);
    // Korean-only label: the site's Latin type is a serif, and mixing it with
    // the Korean sans inside a button reads as two fonts in one word.
    button.appendChild(make('span', 'rmdt-cta-btn-label', '무료로 받기'));
    button.appendChild(make('span', 'rmdt-cta-btn-arrow', '→'));
    box.appendChild(button);

    box.appendChild(make('p', 'rmdt-cta-note', '이름과 휴대폰 번호만 있으면 바로 신청됩니다.'));

    var sub = make('p', 'rmdt-cta-sub', null);
    sub.appendChild(make('span', 'rmdt-cta-sub-label', '이미 신청했다면 '));
    var trackLink = make('a', '', '트랙 변경');
    trackLink.setAttribute('href', CTA_LINKS.signup);
    sub.appendChild(trackLink);
    sub.appendChild(make('span', 'rmdt-cta-sep', ' · '));
    var kakaoLink = make('a', '', '카카오톡 채널 추가');
    kakaoLink.setAttribute('href', CTA_LINKS.kakao);
    kakaoLink.setAttribute('target', '_blank');
    kakaoLink.setAttribute('rel', 'noopener noreferrer');
    sub.appendChild(kakaoLink);
    box.appendChild(sub);

    return box;
  }

  // --- article -------------------------------------------------------------

  function buildArticle(root) {
    var nodes = collectNodes(root);
    if (nodes.length < 3) return null;
    var sections = splitSections(nodes);
    var heroNodes = sections[0].step === 0 ? sections[0].nodes : [];
    var lesson = sections.filter(function (section) { return section.step > 0; });
    if (!lesson.length) return null;

    var fiveStep = lesson.some(function (section) { return section.step >= 5; });
    var article = make('div', '', null);
    article.id = 'rmdt-root';
    var hero = parseHero(heroNodes);
    if (hero.titleEn || hero.titleKo || hero.snackEn) article.appendChild(renderHero(hero));

    var cards = fiveStep ? buildFiveStepCards(lesson) : buildFourStepCards(lesson);
    var rendered = cards.filter(Boolean).length;
    cards.forEach(function (card) { if (card) article.appendChild(card); });
    if (!rendered) return null;

    article.appendChild(renderCta());

    var track = trackFromTitle();
    if (track) article.setAttribute('data-track', track.toLowerCase().replace(/\s+/g, '-'));
    return article;
  }

  function buildFiveStepCards(lesson) {
    var byStep = {};
    lesson.forEach(function (section) { byStep[section.step] = section; });
    var words = byStep[1] ? parseWords(byStep[1].nodes) : { lead: '', words: [] };
    var korean = byStep[2] ? parseNumbered(byStep[2].nodes) : { lead: '', rows: [] };
    var order = byStep[3] ? parseOrder(byStep[3].nodes) : { lead: '', rows: [] };
    var english = byStep[4] ? parseNumbered(byStep[4].nodes) : { lead: '', rows: [] };
    var aaa = byStep[5] ? parseAaa(byStep[5].nodes) : { lead: '', pick: 0, steps: [], messageHouse: false };
    var messageHouse = aaa.messageHouse || /MESSAGE\s*HOUSE/i.test((byStep[5] && byStep[5].title) || '');

    return [
      renderWords(words),
      renderSentences(korean, 2, 'rmdt-sentences', 'rmdt-sentence-text'),
      renderOrder(order),
      renderSentences(english, 4, 'rmdt-english', 'rmdt-english-text'),
      renderAaa(aaa, { korean: korean, english: english }, messageHouse ? MESSAGE_HOUSE_INFO : STEP_INFO[5])
    ];
  }

  function buildFourStepCards(lesson) {
    return lesson.map(function (section) {
      if (section.step === 1) return renderChunks(section);
      if (section.step === 2) return renderWordOrder(section);
      if (section.step === 3) return renderStages(section);
      if (section.step === 4) return renderYourTurn(section);
      return null;
    });
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
    var headingBox = heading && (heading.closest('[class*="wixui-rich-text"]') || heading.parentElement);
    var host = headingBox && headingBox.parentElement;
    if (host && host !== root && !root.contains(headingBox)) {
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
