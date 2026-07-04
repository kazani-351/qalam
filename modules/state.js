import { Leaf, ValidationError, Pos, ChangeSet, Plot, SchemaError, parse, Schema } from 'wordgard/doc';
import { findClusterBreak } from '@marijn/find-cluster-break';

function dec(str) {
    let result = [];
    for (let i = 0; i < str.length; i++)
        result.push(1 << +str[i]);
    return result;
}
const LowTypes = /*@__PURE__*/dec("88888888888888888888888888888888888666888888787833333333337888888000000000000000000000000008888880000000000000000000000000088888888888888888888888888888888888887866668888088888663380888308888800000000000000000000000800000000000000000000000000000008");
const ArabicTypes = /*@__PURE__*/dec("4444448826627288999999999992222222222222222222222222222222222222222222222229999999999999999999994444444444644222822222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222999999949999999229989999223333333333");
const Brackets = /*@__PURE__*/(() => {
    let result = Object.create(null);
    for (let p of ["()", "[]", "{}"]) {
        let l = p.charCodeAt(0), r = p.charCodeAt(1);
        result[l] = r;
        result[r] = -l;
    }
    return result;
})();
const BracketStack = [];
function charType(ch) {
    return ch <= 0xf7 ? LowTypes[ch] :
        0x590 <= ch && ch <= 0x5f4 ? 2 :
            0x600 <= ch && ch <= 0x6f9 ? ArabicTypes[ch - 0x600] :
                0x6ee <= ch && ch <= 0x8ac ? 4 :
                    0x2000 <= ch && ch <= 0x200c ? 256 :
                        0xfb50 <= ch && ch <= 0xfdff ? 4 :
                            ch == 0xfffc ? 256 : 1;
}
const BidiRE = /[\u0590-\u05f4\u0600-\u06ff\u0700-\u08ac\ufb50-\ufdff]/;
class BidiSpan {
    from;
    to;
    level;
    get ltr() { return (this.level % 2) == 0; }
    constructor(
    from, 
    to, 
    level) {
        this.from = from;
        this.to = to;
        this.level = level;
    }
    side(end, ltr) { return (this.ltr == ltr) == end ? this.to : this.from; }
    forward(forward, ltr) { return forward == (this.ltr == ltr); }
    static find(order, index, assoc) {
        let maybe = -1;
        for (let i = 0; i < order.length; i++) {
            let span = order[i];
            if (span.from <= index && span.to >= index &&
                (maybe < 0 || (assoc != 0 ? (assoc < 0 ? span.from < index : span.to > index) : order[maybe].level > span.level)))
                maybe = i;
        }
        if (maybe < 0)
            throw new RangeError("Index out of range");
        return maybe;
    }
    static strongDir(ch) {
        let type = charType(ch);
        if (type == 1)
            return true;
        if (type == 2 || type == 4)
            return false;
        return null;
    }
}
const types = [];
function computeCharTypes(line, rFrom, rTo, isolates, outerType) {
    for (let iI = 0; iI <= isolates.length; iI++) {
        let from = iI ? isolates[iI - 1].to : rFrom, to = iI < isolates.length ? isolates[iI].from : rTo;
        let prevType = iI ? 256 : outerType;
        for (let i = from, prev = prevType, prevStrong = prevType; i < to; i++) {
            let type = charType(line.charCodeAt(i));
            if (type == 512)
                type = prev;
            else if (type == 8 && prevStrong == 4)
                type = 16;
            types[i] = type == 4 ? 2 : type;
            if (type & 7)
                prevStrong = type;
            prev = type;
        }
        for (let i = from, prev = prevType, prevStrong = prevType; i < to; i++) {
            let type = types[i];
            if (type == 128) {
                if (i < to - 1 && prev == types[i + 1] && (prev & 24))
                    type = types[i] = prev;
                else
                    types[i] = 256;
            }
            else if (type == 64) {
                let end = i + 1;
                while (end < to && types[end] == 64)
                    end++;
                let replace = (i && prev == 8) || (end < rTo && types[end] == 8) ? (prevStrong == 1 ? 1 : 8) : 256;
                for (let j = i; j < end; j++)
                    types[j] = replace;
                i = end - 1;
            }
            else if (type == 8 && prevStrong == 1) {
                types[i] = 1;
            }
            prev = type;
            if (type & 7)
                prevStrong = type;
        }
    }
}
function processBracketPairs(line, rFrom, rTo, isolates, outerType) {
    let oppositeType = outerType == 1 ? 2 : 1;
    for (let iI = 0, sI = 0, context = 0; iI <= isolates.length; iI++) {
        let from = iI ? isolates[iI - 1].to : rFrom, to = iI < isolates.length ? isolates[iI].from : rTo;
        for (let i = from, ch, br, type; i < to; i++) {
            if (br = Brackets[ch = line.charCodeAt(i)]) {
                if (br < 0) {                    for (let sJ = sI - 3; sJ >= 0; sJ -= 3) {
                        if (BracketStack[sJ + 1] == -br) {
                            let flags = BracketStack[sJ + 2];
                            let type = (flags & 2) ? outerType :
                                !(flags & 4) ? 0 :
                                    (flags & 1) ? oppositeType : outerType;
                            if (type)
                                types[i] = types[BracketStack[sJ]] = type;
                            sI = sJ;
                            break;
                        }
                    }
                }
                else if (BracketStack.length == 189) {
                    break;
                }
                else {
                    BracketStack[sI++] = i;
                    BracketStack[sI++] = ch;
                    BracketStack[sI++] = context;
                }
            }
            else if ((type = types[i]) == 2 || type == 1) {
                let embed = type == outerType;
                context = embed ? 0 : 1;
                for (let sJ = sI - 3; sJ >= 0; sJ -= 3) {
                    let cur = BracketStack[sJ + 2];
                    if (cur & 2)
                        break;
                    if (embed) {
                        BracketStack[sJ + 2] |= 2;
                    }
                    else {
                        if (cur & 4)
                            break;
                        BracketStack[sJ + 2] |= 4;
                    }
                }
            }
        }
    }
}
function processNeutrals(rFrom, rTo, isolates, outerType) {
    for (let iI = 0, prev = outerType; iI <= isolates.length; iI++) {
        let from = iI ? isolates[iI - 1].to : rFrom, to = iI < isolates.length ? isolates[iI].from : rTo;
        for (let i = from; i < to;) {
            let type = types[i];
            if (type == 256) {
                let end = i + 1;
                for (;;) {
                    if (end == to) {
                        if (iI == isolates.length)
                            break;
                        end = isolates[iI++].to;
                        to = iI < isolates.length ? isolates[iI].from : rTo;
                    }
                    else if (types[end] == 256) {
                        end++;
                    }
                    else {
                        break;
                    }
                }
                let beforeL = prev == 1;
                let afterL = (end < rTo ? types[end] : outerType) == 1;
                let replace = beforeL == afterL ? (beforeL ? 1 : 2) : outerType;
                for (let j = end, jI = iI, fromJ = jI ? isolates[jI - 1].to : rFrom; j > i;) {
                    if (j == fromJ) {
                        j = isolates[--jI].from;
                        fromJ = jI ? isolates[jI - 1].to : rFrom;
                    }
                    types[--j] = replace;
                }
                i = end;
            }
            else {
                prev = type;
                i++;
            }
        }
    }
}
function emitSpans(line, from, to, level, baseLevel, isolates, order) {
    let ourType = level % 2 ? 2 : 1;
    if ((level % 2) == (baseLevel % 2)) {        for (let iCh = from, iI = 0; iCh < to;) {
            let sameDir = true, isNum = false;
            if (iI == isolates.length || iCh < isolates[iI].from) {
                let next = types[iCh];
                if (next != ourType) {
                    sameDir = false;
                    isNum = next == 16;
                }
            }
            let recurse = !sameDir && ourType == 1 ? [] : null;
            let localLevel = sameDir ? level : level + 1;
            let iScan = iCh;
            run: for (;;) {
                if (iI < isolates.length && iScan == isolates[iI].from) {
                    if (isNum)
                        break run;
                    let iso = isolates[iI];
                    if (!sameDir)
                        for (let upto = iso.to, jI = iI + 1;;) {
                            if (upto == to)
                                break run;
                            if (jI < isolates.length && isolates[jI].from == upto)
                                upto = isolates[jI++].to;
                            else if (types[upto] == ourType)
                                break run;
                            else
                                break;
                        }
                    iI++;
                    if (recurse) {
                        recurse.push(iso);
                    }
                    else {
                        if (iso.from > iCh)
                            order.push(new BidiSpan(iCh, iso.from, localLevel));
                        let dirSwap = iso.ltr != !(localLevel % 2);
                        computeSectionOrder(line, dirSwap ? level + 1 : level, baseLevel, iso.inner, iso.from, iso.to, order);
                        iCh = iso.to;
                    }
                    iScan = iso.to;
                }
                else if (iScan == to || (sameDir ? types[iScan] != ourType : types[iScan] == ourType)) {
                    break;
                }
                else {
                    iScan++;
                }
            }
            if (recurse)
                emitSpans(line, iCh, iScan, level + 1, baseLevel, recurse, order);
            else if (iCh < iScan)
                order.push(new BidiSpan(iCh, iScan, localLevel));
            iCh = iScan;
        }
    }
    else {
        for (let iCh = to, iI = isolates.length; iCh > from;) {
            let sameDir = true, isNum = false;
            if (!iI || iCh > isolates[iI - 1].to) {
                let next = types[iCh - 1];
                if (next != ourType) {
                    sameDir = false;
                    isNum = next == 16;
                }
            }
            let recurse = !sameDir && ourType == 1 ? [] : null;
            let localLevel = sameDir ? level : level + 1;
            let iScan = iCh;
            run: for (;;) {
                if (iI && iScan == isolates[iI - 1].to) {
                    if (isNum)
                        break run;
                    let iso = isolates[--iI];
                    if (!sameDir)
                        for (let upto = iso.from, jI = iI;;) {
                            if (upto == from)
                                break run;
                            if (jI && isolates[jI - 1].to == upto)
                                upto = isolates[--jI].from;
                            else if (types[upto - 1] == ourType)
                                break run;
                            else
                                break;
                        }
                    if (recurse) {
                        recurse.push(iso);
                    }
                    else {
                        if (iso.to < iCh)
                            order.push(new BidiSpan(iso.to, iCh, localLevel));
                        let dirSwap = iso.ltr != !(localLevel % 2);
                        computeSectionOrder(line, dirSwap ? level + 1 : level, baseLevel, iso.inner, iso.from, iso.to, order);
                        iCh = iso.from;
                    }
                    iScan = iso.from;
                }
                else if (iScan == from || (sameDir ? types[iScan - 1] != ourType : types[iScan - 1] == ourType)) {
                    break;
                }
                else {
                    iScan--;
                }
            }
            if (recurse)
                emitSpans(line, iScan, iCh, level + 1, baseLevel, recurse, order);
            else if (iScan < iCh)
                order.push(new BidiSpan(iScan, iCh, localLevel));
            iCh = iScan;
        }
    }
}
function computeSectionOrder(line, level, baseLevel, isolates, from, to, order) {
    let outerType = (level % 2 ? 2 : 1);
    computeCharTypes(line, from, to, isolates, outerType);
    processBracketPairs(line, from, to, isolates, outerType);
    processNeutrals(from, to, isolates, outerType);
    emitSpans(line, from, to, level, baseLevel, isolates, order);
}
function computeOrder(line, ltr, isolates) {
    if (!line)
        return [new BidiSpan(0, 0, ltr ? 0 : 1)];
    if (ltr && !isolates.length && !BidiRE.test(line))
        return trivialOrder(line.length);
    if (isolates.length)
        while (line.length > types.length)
            types[types.length] = 256;    let order = [], level = ltr ? 0 : 1;
    computeSectionOrder(line, level, level, isolates, 0, line.length, order);
    return order;
}
function trivialOrder(length) {
    return [new BidiSpan(0, length, 0)];
}

const cache = /*@__PURE__*/(() => new WeakMap)();
class TextblockMap {
    start;
    node;
    ltr;
    text;
    _order;
    sections;
    constructor(
    start, 
    node, 
    ltr, 
    text, _order, 
    sections) {
        this.start = start;
        this.node = node;
        this.ltr = ltr;
        this.text = text;
        this._order = _order;
        this.sections = sections;
    }
    get order() {
        return this._order || (this._order = computeOrder(this.text, this.ltr, []));
    }
    static get(start, node, ltr) {
        let cached = cache.get(node);
        if (cached && cached.start == start && cached.ltr == ltr)
            return cached;
        let result = cached && cached.ltr == ltr
            ? new TextblockMap(start, node, ltr, cached.text, cached._order, cached.sections)
            : TextblockMap.create(start, node, ltr);
        cache.set(node, result);
        return result;
    }
    static create(start, node, ltr) {
        let text = "", sections = [], sectionPos = 0;
        let flush = (upto) => {
            if (upto > sectionPos)
                sections.push((upto - sectionPos) << 2);
        };
        let scan = (node, pos) => {
            for (let ch of node.content) {
                if (ch.is(Leaf.Text)) {
                    text += ch.param;
                }
                else if (ch.isLeaf || !ch.inlineContent) {
                    text += "\ufffc";
                    if (ch.length > 1) {
                        flush(pos);
                        sections.push((ch.length << 2) | 1);
                        sectionPos = pos + ch.length;
                    }
                }
                else if (ch.type.spec.cursorInsideBounds) {
                    text += " ";
                    scan(ch, pos + 1);
                    text += " ";
                }
                else {
                    flush(pos);
                    sections.push((1 << 2) | 3);
                    scan(ch, sectionPos = pos + 1);
                    flush(pos + ch.length - 1);
                    sections.push((1 << 2) | 2);
                    sectionPos = pos + ch.length;
                }
                pos += ch.length;
            }
        };
        scan(node, 0);
        flush(node.contentLength);
        return new TextblockMap(start, node, ltr, text, null, sections);
    }
    toIndex(pos) {
        if (pos < this.start)
            return 0;
        let off = pos - this.start, idx = 0;
        for (let n of this.sections) {
            let len = n >> 2, flag = n & 3;
            if (flag == 0) {
                if (off <= len)
                    return idx + off;
                off -= len;
                idx += len;
            }
            else if (flag == 1) {
                off -= len;
                if (off < 0)
                    return idx;
                idx++;
            }
            else {
                off--;
            }
        }
        return idx;
    }
    fromIndex(index) {
        let off = this.start;
        for (let n of this.sections) {
            let len = n >> 2, flag = n & 3;
            if (flag == 0) {
                if (len > index)
                    return off + index;
                index -= len;
            }
            else if (flag == 1) {
                if (!index)
                    return off;
                index--;
            }
            else {
                if (!index)
                    return off + (flag == 2 ? 1 : 0);
            }
            off += len;
        }
        return off;
    }
    moveVisually(start, side, forward, skipped) {
        let startIndex = this.toIndex(start), { order, ltr } = this;
        let spanI = BidiSpan.find(order, startIndex, side);
        let span = order[spanI], spanEnd = span.side(forward, ltr);
        if (startIndex == spanEnd) {
            let nextI = spanI += forward ? 1 : -1;
            if (nextI < 0 || nextI >= order.length)
                return null;
            span = order[spanI = nextI];
            startIndex = span.side(!forward, ltr);
            spanEnd = span.side(forward, ltr);
        }
        let nextIndex = findClusterBreak(this.text, startIndex, span.forward(forward, ltr));
        if (nextIndex == startIndex)
            return null;
        if (nextIndex < span.from || nextIndex > span.to)
            nextIndex = spanEnd;
        if (skipped)
            skipped[0] = this.text.slice(Math.min(startIndex, nextIndex), Math.max(startIndex, nextIndex));
        let nextSpan = spanI == (forward ? order.length - 1 : 0) ? null : order[spanI + (forward ? 1 : -1)];
        if (nextSpan && nextIndex == spanEnd && nextSpan.level + (forward ? 0 : 1) < span.level)
            return { pos: this.fromIndex(nextSpan.side(!forward, ltr)), side: nextSpan.forward(forward, ltr) ? 1 : -1 };
        return { pos: this.fromIndex(nextIndex), side: span.forward(forward, ltr) ? -1 : 1 };
    }
    skipWord(start, side, forward, visually) {
        let word = "", skipped = [""], cur = null;
        let history = new Map();
        for (;;) {
            let next, char, from = cur ? cur.pos : start;
            if (visually) {
                next = this.moveVisually(from, cur ? cur.side : side, forward, skipped);
                char = skipped[0];
            }
            else {
                next = this.moveLogically(from, forward);
                char = next ? this.text.slice(Math.min(next.pos, from), Math.max(next.pos, from)) : "";
            }
            if (!next)
                break;
            if (/\p{L}|\p{N}/u.test(char)) {
                if (forward)
                    word += char;
                else
                    word = skipped[0] + word;
                history.set(word.length, next);
            }
            else if (word) {
                break;
            }
            cur = next;
        }
        if (!word)
            return null;
        if (!Intl.Segmenter)
            return cur;        let segments = [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(word)];
        return history.get(segments[forward ? 0 : segments.length - 1].segment.length) || cur;
    }
    visualSide(start) {
        let pos, side;
        if (start) {
            let span = this.order[0];
            [pos, side] = span.ltr == this.ltr ? [span.from, 1] : [span.to, -1];
        }
        else {
            let span = this.order[this.order.length - 1];
            [pos, side] = span.ltr == this.ltr ? [span.to, -1] : [span.from, 1];
        }
        return { pos: this.fromIndex(pos), side };
    }
    moveLogically(start, forward) {
        let index = this.toIndex(start);
        let next = findClusterBreak(this.text, index, forward);
        return next == index ? null : { pos: this.fromIndex(next), side: forward ? -1 : 1 };
    }
}

class SelectionType {
    tag;
    cls;
    toJSON;
    fromJSON;
    constructor(tag, cls, toJSON, fromJSON) {
        this.tag = tag;
        this.cls = cls;
        this.toJSON = toJSON;
        this.fromJSON = fromJSON;
    }
}
class GardSelection {
    anchor;
    head;
    goalColumn;
    constructor(
    anchor, 
    head, 
    goalColumn) {
        this.anchor = anchor;
        this.head = head;
        this.goalColumn = goalColumn;
    }
    get from() { return Math.min(this.anchor, this.head); }
    get to() { return Math.max(this.anchor, this.head); }
    get empty() { return this.anchor == this.head; }
    get isCursor() { return this.empty && this instanceof GardSelection.Text; }
    get ranges() { return [this]; }
    get replacementRange() { return this; }
    get domSelection() { return this; }
    get headSide() { return this.head > this.anchor ? -1 : 1; }
    get anchorSide() { return this.anchor > this.head ? -1 : 1; }
    eqPos(other) {
        return this.anchor == other.anchor && this.head == other.head;
    }
    check(config, doc) {
        if (!config.staticFacet(GardSelection.selectionType).some(t => this instanceof t.cls))
            throw new RangeError("Unsupported selection type");
        for (let { from, to } of this.ranges)
            if (from < 0 || to > doc.length)
                throw new RangeError(`Selection out of document range`);
    }
    resolve(doc) { return GardSelection.Resolved.create(doc, this); }
    toJSON(state) {
        let type = state.facet(GardSelection.selectionType).find(tp => this instanceof tp.cls);
        if (!type)
            throw new Error("Selection type not enabled in state given to GardSelection.toJSON");
        let result = type.toJSON(this);
        result.type = type.tag;
        return result;
    }
    static fromJSON(cx, json) {
        let { doc, config } = cx, tag = json.type;
        let types = config.staticFacet(GardSelection.selectionType);
        let type = types.find(tp => tp.tag == tag);
        if (!type)
            throw new Error(`Unknown selection type '${tag}' in GardSelection.fromJSON`);
        return type.fromJSON(doc, json);
    }
    static cursor(pos, side, goalColumn) {
        return GardSelection.Text.createInner(pos, pos, side, goalColumn);
    }
    static range(anchor, head, headSide, goalColumn) {
        return GardSelection.Text.createInner(anchor, head ?? anchor, headSide, goalColumn);
    }
    static node(pos, node, goalColumn) {
        return GardSelection.Node.create(pos, node, goalColumn);
    }
    nextNormalCursor(cx, forward = true) {
        let found = scanNormalFrom(cx, this.head, this.headSide, forward, true);
        return found && GardSelection.cursor(found.pos, found.side);
    }
    normalCursorAtBound(cx, forward = true) {
        let found = scanNormalFrom(cx, forward ? this.to : this.from, forward ? -1 : 1, forward, false);
        return found && GardSelection.cursor(found.pos, found.side);
    }
    skipWord(cx, forward = true) {
        let found = skipWord(cx, this.head, this.headSide, forward);
        return found && GardSelection.cursor(found.pos, found.side);
    }
    static near(cx, pos, bias = 1) {
        let norm = scanNormalFrom(cx, pos, bias, bias > 0, false) ??
            scanNormalFrom(cx, pos, -bias, bias < 0, false) ??
            { pos: pos, side: -1 };
        return GardSelection.cursor(norm.pos, norm.side);
    }
    static atStart(cx, block) {
        return cursorAtStart(cx, block);
    }
    static atEnd(cx, block) {
        let found = block
            ? TextblockMap.get(block.start, block.node, cx.config.textblockLTR(block.node)).visualSide(false)
            : cx.doc.inlineContent ? TextblockMap.get(0, cx.doc, cx.config.textLTR).visualSide(false)
                : scanNormalFrom(cx, cx.doc.length, -1, false, false) ?? { pos: cx.doc.length, side: -1 };
        return GardSelection.cursor(found.pos, found.side);
    }
}
;GardSelection = /*@__PURE__*/(function (GardSelection) {
    function define(tag, cls, toJSON, fromJSON) {
        return GardSelection.selectionType.of(new SelectionType(tag, cls, toJSON, fromJSON));
    }
    GardSelection.define = define;
    class Text extends GardSelection {
        _headSide;
        marks;
        constructor(anchor, head, _headSide, goalColumn, 
        marks) {
            super(anchor, head, goalColumn);
            this._headSide = _headSide;
            this.marks = marks;
        }
        static createInner(anchor, head, side, goalColumn, marks) {
            return new Text(anchor, head, side ?? (head > anchor ? -1 : 1), goalColumn, marks);
        }
        get headSide() {
            return this._headSide;
        }
        get anchorSide() {
            return this.anchor == this.head ? this._headSide : super.anchorSide;
        }
        static create(spec) {
            let { anchor, head = anchor } = spec;
            return Text.createInner(anchor, head, spec.headSide, spec.goalColumn, spec.marks);
        }
        map(change, cx, assoc = -1) {
            let from, to;
            if (this.empty) {
                from = to = change.mapPos(this.from, assoc);
            }
            else {
                from = change.mapPos(this.from, 1);
                to = Math.max(from, change.mapPos(this.to, -1));
            }
            return Text.createInner(from, to, this.headSide, this.goalColumn, this.marks);
        }
        eq(other) {
            return other instanceof Text && this.eqPos(other) && this.headSide == other.headSide &&
                (this.marks == other.marks || !!(this.marks && other.marks && this.marks.length == other.marks.length &&
                    this.marks.every((p, i) => p.eq(other.marks[i]))));
        }
    }
    GardSelection.Text = Text;
    (function (Text) {
        Text.type = new SelectionType("text", Text, ((sel) => {
            let result = { anchor: sel.anchor };
            if (sel.headSide != (sel.head > sel.anchor ? -1 : 1))
                result.side = sel.headSide;
            if (!sel.empty)
                result.head = sel.head;
            if (sel.marks) {
                result.marks = {};
                for (let mark of sel.marks)
                    result.marks[mark.name] = mark.value;
            }
            return result;
        }), ((doc, json) => {
            if (!json || typeof json.anchor != "number")
                throw new ValidationError("Invalid JSON representation for GardSelection.Text");
            let anchor = json.anchor, head = typeof json.head == "number" ? json.head : anchor;
            let marks = json.marks ? doc.schema.marksFromJSON(json.marks) : undefined;
            return Text.createInner(anchor, head, json.side == 1 || json.side == -1 ? json.side : undefined, undefined, marks);
        }));
    })(Text = GardSelection.Text || (GardSelection.Text = {}));
    class Node extends GardSelection {
        node;
        constructor(from, to, 
        node, goalColumn) {
            super(from, to, goalColumn);
            this.node = node;
        }
        static create(pos, node, goalColumn) {
            return new Node(pos, pos + node.length, node, goalColumn);
        }
        map(change, cx, assoc = -1) {
            let newPos = change.mapPos(this.anchor, 1, "after");
            if (newPos == null)
                return GardSelection.near(cx, change.mapPos(this.anchor, assoc), assoc);
            return Node.create(newPos, cx.doc.nodeAt(newPos));
        }
        eq(other) {
            return other instanceof Node && other.anchor == this.anchor;
        }
    }
    GardSelection.Node = Node;
    (function (Node) {
        Node.type = new SelectionType("node", Node, (sel) => ({ pos: sel.anchor }), (doc, json) => {
            let node = json && typeof json.pos == "number" && doc.nodeAt(json.pos);
            if (!node || node.isText || node.isPlot || !node.type.isSelectable)
                throw new ValidationError("Invalid GardSelection.Node JSON representation");
            return Node.create(json.pos, node);
        });
    })(Node = GardSelection.Node || (GardSelection.Node = {}));
    class Resolved {
        doc;
        selection;
        anchor;
        head;
        _ranges = null;
        constructor(
        doc, 
        selection) {
            this.doc = doc;
            this.selection = selection;
            this.anchor = doc.resolve(selection.anchor);
            this.head = selection.empty ? this.anchor : doc.resolve(selection.head);
        }
        static create(doc, selection) { return new Resolved(doc, selection); }
        get from() { return this.anchor.pos < this.head.pos ? this.anchor : this.head; }
        get to() { return this.anchor.pos > this.head.pos ? this.anchor : this.head; }
        get ranges() {
            return this._ranges || (this._ranges = this.resolveRanges());
        }
        resolveRanges() {
            return this.selection.ranges.map(({ from, to }) => ({ from: this.doc.resolve(from), to: this.doc.resolve(to) }));
        }
        get replacementRange() {
            let repl = this.selection.replacementRange;
            if (repl.from == this.selection.from && repl.to == this.selection.to)
                return this;
            return { from: this.doc.resolve(repl.from), to: this.doc.resolve(repl.to) };
        }
        get activeMarks() {
            let repl = this.replacementRange;
            return (this.selection instanceof GardSelection.Text && this.selection.marks) || repl.from.marks(repl.to);
        }
    }
    GardSelection.Resolved = Resolved;
;return GardSelection})(GardSelection);
function cursorAtStart(cx, block) {
    let found = block
        ? TextblockMap.get(block.start, block.node, cx.config.textblockLTR(block.node)).visualSide(true)
        : cx.doc.inlineContent ? TextblockMap.get(0, cx.doc, cx.config.textblockLTR(cx.doc)).visualSide(true)
            : scanNormalFrom(cx, 0, 1, true, false) ?? { pos: 0, side: 1 };
    return GardSelection.cursor(found.pos, found.side);
}
function isBarrier(node) {
    if (node.isLeaf)
        return node.type.isBlock;
    let override = node.type.spec.cursorBarrier;
    if (override != null)
        return override;
    return node.type.isolating || node.type.preserveWhitespace || node.type.isBlock && node.type.isAtom;
}
function scanNormalFrom(cx, from, side, forward, mustMove) {
    let pos = cx.doc.resolve(from), pastBarrier = false;
    if (pos.parent.node.inlineContent) {
        if (!mustMove)
            return { pos: pos.pos, side };
        let block = pos.textblockParent;
        let map = TextblockMap.get(block.start, block.node, cx.config.textblockLTR(block.node));
        let next = cx.config.visualCursorMotion ? map.moveVisually(pos.pos, side, forward) : map.moveLogically(pos.pos, forward);
        if (next != null)
            return next;
        if (!block.parent)
            return null;
        pos = Pos.create(block.parent, forward ? block.after : block.before, block.index + (forward ? 1 : 0), 0);
        pastBarrier = isBarrier(block.node);
    }
    else {
        pastBarrier = !pos.parent.parent && pos.index == (forward ? 0 : pos.parent.node.content.length);
        for (let { parent: { node }, index } = pos; !pastBarrier && (forward ? index : index < node.content.length);) {
            let next = node.content[forward ? index - 1 : index];
            if (isBarrier(next))
                pastBarrier = true;
            if (next.isLeaf) {
                index += forward ? 1 : -1;
            }
            else {
                if (next.inlineContent)
                    break;
                node = next;
                index = forward ? next.content.length : 0;
            }
        }
    }
    let bottom = pos.pos, step = forward ? 1 : -1;
    for (let { parent, index } = pos, p = pos.pos;;) {
        let { node, parent: next } = parent;
        if (node.inlineContent) {
            if (cx.config.visualCursorMotion)
                return TextblockMap.get(parent.start, parent.node, cx.config.textblockLTR(parent.node)).visualSide(forward);
            return { pos: p, side: forward ? 1 : -1 };
        }
        if (index == (forward ? node.content.length : 0)) {
            let barrier = !next || isBarrier(node);
            if ((bottom != from || !mustMove) && pastBarrier && barrier)
                return { pos: bottom, side: forward ? -1 : 1 };
            if (!next)
                return null;
            index = parent.index + (forward ? 1 : 0);
            parent = next;
            p += step;
            bottom = p;
            if (barrier)
                pastBarrier = true;
        }
        else {
            let nextNode = node.content[index - (forward ? 0 : 1)];
            let barrier = isBarrier(nextNode);
            if (pastBarrier && (bottom != from || !mustMove) && barrier)
                return { pos: bottom, side: forward ? -1 : 1 };
            if (nextNode.isLeaf || nextNode.type.isAtom) {
                index += step;
                p += nextNode.length * step;
            }
            else {
                if (!forward)
                    index--;
                parent = Pos.Plot.create(parent, nextNode, forward ? p : p - nextNode.length, index);
                p += step;
                index = forward ? 0 : nextNode.content.length;
            }
            if (barrier) {
                pastBarrier = true;
                bottom = p;
            }
        }
    }
}
function skipWord(cx, start, side, forward) {
    let last = null;
    for (let pos = start, visually = cx.config.visualCursorMotion;;) {
        let block = cx.doc.resolve(pos).textblockParent;
        if (!block) {
            let next = scanNormalFrom(cx, pos, side, forward, true);
            if (!next)
                return last;
            ({ pos, side } = next);
        }
        else {
            let map = TextblockMap.get(block.start, block.node, cx.config.textblockLTR(block.node));
            let next = map.skipWord(pos, side, forward, visually);
            if (next)
                return next;
            if (!block.parent)
                return last;
            let end = visually ? map.visualSide(!forward)
                : forward ? { pos: block.end, side: -1 } : { pos: block.start, side: 1 };
            if (end.pos != start)
                last = end;
            pos = forward ? block.after : block.before;
        }
    }
}
function wordAt(state, pos, bias) {
    let res = state.doc.resolve(pos);
    if (!res.parent.node.inlineContent)
        return GardSelection.cursor(pos, bias);
    let start = pos, end = pos, text = "";
    scanBack: for (let i = res.index - (res.inText ? 0 : 1), cur = res.nodeBefore; cur;) {
        if (!cur.is(Leaf.Text))
            break;
        for (let j = cur.length; j > 0;) {
            let next = findClusterBreak(cur.param, j, false);
            let ch = cur.param.slice(next, j);
            if (!/\p{L}|\p{N}/u.test(ch))
                break scanBack;
            text = ch + text;
            start -= (j - next);
            j = next;
        }
        if (!i)
            break;
        cur = res.parent.node.content[--i];
    }
    scanForward: for (let i = res.index + 1, cur = res.nodeAfter; cur;) {
        if (!cur.is(Leaf.Text))
            break;
        for (let j = 0; j < cur.length;) {
            let next = findClusterBreak(cur.param, j, true);
            let ch = cur.param.slice(j, next);
            if (!/\p{L}|\p{N}/u.test(ch))
                break scanForward;
            text += ch;
            end += (next - j);
            j = next;
        }
        if (i == res.parent.node.content.length)
            break;
        cur = res.parent.node.content[i++];
    }
    if (!Intl.Segmenter)
        return GardSelection.range(start, end);
    let best = null, local = pos - start;
    for (let segment of new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)) {
        if (segment.isWordLike && segment.index <= local && segment.index + segment.segment.length >= local && (!best || bias > 0))
            best = segment;
    }
    return best ? GardSelection.range(start + best.index, start + best.index + best.segment.length) : GardSelection.cursor(pos, bias);
}

class Transaction {
    startState;
    changes;
    selection;
    effects;
    annotations;
    scrollIntoView;
    _state = null;
    constructor(
    startState, 
    changes, 
    selection, 
    effects, 
    annotations, 
    scrollIntoView) {
        this.startState = startState;
        this.changes = changes;
        this.selection = selection;
        this.effects = effects;
        this.annotations = annotations;
        this.scrollIntoView = scrollIntoView;
        if (!annotations.some((a) => a.type == Transaction.time))
            this.annotations = annotations.concat(Transaction.time.of(Date.now()));
        this.newDoc = this.changes.apply(this.startState.doc);
        this.newSelection = selection || startState.selection.map(changes, { doc: this.newDoc, config: this.startState.config });
        this.newSelection.check(startState.config, this.newDoc);
    }
    newSelection;
    newDoc;
    static create(startState, spec) {
        return new Transaction(startState, spec.changes, spec.selection, spec.effects, spec.annotations, spec.scrollIntoView);
    }
    get state() {
        if (!this._state)
            this.startState.applyTransaction(this);
        return this._state;
    }
    annotation(type) {
        for (let ann of this.annotations)
            if (ann.type == type)
                return ann.value;
        return undefined;
    }
    get docChanged() { return !this.changes.empty; }
    get reconfigured() { return this.startState.config != this.state.config; }
    isUserEvent(event) {
        let e = this.annotation(Transaction.userEvent);
        return !!(e && (e == event || e.length > event.length && e.startsWith(event) && e[event.length] == "."));
    }
}
;Transaction = /*@__PURE__*/(function (Transaction) {
    function merge(state, a, b) {
        let rA = resolveTransactionInner(state, null, a);
        return mergeTransaction(state, rA, resolveTransactionInner(state, rA.changes, b));
    }
    Transaction.merge = merge;
    function append(tr) {
        let result = [tr], top = tr.state;
        let appenders = tr.startState.facet(Transaction.appender);
        if (!appenders.length)
            return result;
        for (let seen = appenders.map(() => 0);;) {
            let done = true;
            for (let i = 0; i < appenders.length; i++) {
                let from = seen[i];
                if (from < result.length) {
                    let add = appenders[i](from ? result.slice(from) : result, top);
                    if (add) {
                        let tr = top.update(Transaction.merge(top, add, { annotations: Transaction.appended.of(true) }));
                        result.push(tr);
                        top = tr.state;
                        done = false;
                    }
                    seen[i] = result.length;
                }
            }
            if (done)
                return result;
        }
    }
    Transaction.append = append;
    class Annotation {
        type;
        value;
        constructor(
        type, 
        value) {
            this.type = type;
            this.value = value;
        }
        static define() { return new Transaction.Annotation.Type(); }
    }
    Transaction.Annotation = Annotation;
    (function (Annotation) {
        class Type {
            of(value) { return new Transaction.Annotation(this, value); }
        }
        Annotation.Type = Type;
    })(Annotation = Transaction.Annotation || (Transaction.Annotation = {}));
    Transaction.time = Transaction.Annotation.define();
    Transaction.userEvent = Annotation.define();
    Transaction.addToHistory = Annotation.define();
    Transaction.remote = Annotation.define();
    Transaction.appended = Annotation.define();
    class Effect {
        type;
        value;
        constructor(
        type, 
        value) {
            this.type = type;
            this.value = value;
        }
        map(mapping) {
            let mapped = this.type.map(this.value, mapping);
            return mapped === undefined ? undefined : mapped == this.value ? this : new Transaction.Effect(this.type, mapped);
        }
        is(type) { return this.type == type; }
        static define(spec = {}) {
            return new Transaction.Effect.Type(spec.map || (v => v));
        }
    }
    Transaction.Effect = Effect;
    (function (Effect) {
        function mapEffects(effects, mapping) {
            if (!effects.length)
                return effects;
            let result = [];
            for (let effect of effects) {
                let mapped = effect.map(mapping);
                if (mapped)
                    result.push(mapped);
            }
            return result;
        }
        Effect.mapEffects = mapEffects;
        class Type {
            map;
            constructor(
            map) {
                this.map = map;
            }
            of(value) { return new Transaction.Effect(this, value); }
        }
        Effect.Type = Type;
    })(Effect = Transaction.Effect || (Transaction.Effect = {}));
;return Transaction})(Transaction);
function selCx(config, doc, changes) {
    let newDoc;
    return { get doc() { return newDoc || (newDoc = changes.apply(doc)); }, config };
}
function mergeTransaction(state, a, b) {
    let changes = a.changes.compose(b.changes);
    return {
        changes,
        selection: b.selection || (a.selection && a.selection.map(b.changes, selCx(state.config, state.doc, changes))),
        effects: Transaction.Effect.mapEffects(a.effects, b.changes).concat(b.effects),
        annotations: a.annotations.length ? a.annotations.concat(b.annotations) : b.annotations,
        scrollIntoView: a.scrollIntoView || b.scrollIntoView
    };
}
function resolveTransactionInner(state, after, spec) {
    let { changes, sequential } = spec;
    if (after && after.empty)
        after = null;
    let doc = after && sequential ? after.apply(state.doc) : state.doc;
    if (!(changes instanceof ChangeSet))
        changes = ChangeSet.create(doc, changes || []);
    let effects = asArray(spec.effects), annotations = asArray(spec.annotations);
    if (spec.userEvent)
        annotations = annotations.concat(Transaction.userEvent.of(spec.userEvent));
    let selection = !spec.selection ? undefined
        : spec.selection instanceof GardSelection ? spec.selection
            : typeof spec.selection == "function" ? spec.selection({ doc: changes.apply(doc), config: state.config }, changes) ?? undefined
                : GardSelection.Text.create(spec.selection);
    if (after && !sequential) {
        if (selection) {
            let { a, b } = ChangeSet.transform(state.doc, after, changes);
            selection = selection.map(a, selCx(state.config, doc, changes));
            changes = b;
        }
        else {
            changes = changes.transform(after, state.doc);
        }
        effects = Transaction.Effect.mapEffects(effects, after);
    }
    return { changes, selection, effects, annotations, scrollIntoView: !!spec.scrollIntoView };
}
function resolveTransaction(state, spec) {
    let s = resolveTransactionInner(state, null, spec);
    let extenders = state.facet(Transaction.extender), tr = Transaction.create(state, s);
    for (let i = extenders.length - 1; i >= 0; i--) {
        let extension = extenders[i](tr);
        if (extension) {
            s = mergeTransaction(state, s, resolveTransactionInner(state, tr.changes, extension));
            tr = Transaction.create(state, s);
        }
    }
    return tr;
}
const none$1 = [];
function asArray(value) {
    return value == null ? none$1 : Array.isArray(value) ? value : [value];
}

let nextID = 0;
const none = [];
function readHTML(html) {
    if (typeof document != "object" || !document.implementation)
        throw new Error("Trying to parse an HTML string in a non-browser context.");
    let detachedDoc = document.implementation.createHTMLDocument("title");
    let trustedTypes = window.trustedTypes;
    if (trustedTypes) {
        html = trustedTypes.createPolicy("detachedDocument", { createHTML: (s) => s }).createHTML(html);
    }
    let elt = detachedDoc.createElement("div");
    elt.innerHTML = html;
    return elt;
}
function readDoc(schema, doc) {
    if (!doc)
        return schema.doc(schema.docTag.type.canBeEmpty ? [] : [
            schema.createAndFill(schema.defaultContentTag(schema.docTag.type))
        ]);
    if (doc instanceof Plot.Doc)
        return doc.schema == schema ? doc : schema.doc(doc.content);
    if (typeof doc == "function")
        return doc(schema);
    if (typeof doc == "string")
        doc = readHTML(doc);
    let { nodeType } = doc;
    if (nodeType === 1 || nodeType === 11)
        return parse(schema, doc);
    return schema.docFromJSON(doc);
}
class GardState {
    config;
    _doc;
    _selection;
    values;
    status;
    computeSlot;
    resolvedSel = null;
    trackAccess = null;
    static create(spec) {
        let config = spec.config instanceof GardState.Configuration ? spec.config
            : GardState.Configuration.resolve(spec.config || [], new Map);
        let schema = config.schema;
        if (!schema) {
            if (spec.doc instanceof Plot.Doc)
                schema = spec.doc.schema;
            else
                throw new SchemaError(`No document plot provided, unable to create schema`);
        }
        let doc = readDoc(schema, spec.doc);
        let selection = !spec.selection ? cursorAtStart({ doc, config })
            : typeof spec.selection == "function" ? spec.selection({ doc, config })
                : spec.selection instanceof GardSelection ? spec.selection
                    : GardSelection.Text.create(spec.selection);
        return GardState.fromConfig(config, doc, selection);
    }
    constructor(
    config, _doc, _selection, 
    values, computeSlot, tr) {
        this.config = config;
        this._doc = _doc;
        this._selection = _selection;
        this.values = values;
        this.status = config.statusTemplate.slice();
        this.computeSlot = computeSlot;
        if (tr)
            tr._state = this;
        for (let i = 0; i < this.config.dynamicSlots.length; i++)
            ensureAddr(this, i << 1);
        this.computeSlot = null;
    }
    get doc() {
        if (this.trackAccess)
            addValue(this.trackAccess, "doc");
        return this._doc;
    }
    get schema() {
        if (this.trackAccess)
            addValue(this.trackAccess, "schema");
        return this._doc.schema;
    }
    get selection() {
        if (this.trackAccess)
            addValue(this.trackAccess, "selection");
        return this._selection;
    }
    get sel() {
        return this.resolvedSel || (this.resolvedSel = this.selection.resolve(this.doc));
    }
    field(field, require = true) {
        let addr = this.config.address[field.id];
        if (addr == null) {
            if (require)
                throw new RangeError("Field is not present in this state");
            return undefined;
        }
        let track = this.trackAccess;
        if (track) {
            addValue(track, field);
            track = null;
        }
        ensureAddr(this, addr);
        if (track)
            this.trackAccess = track;
        return getAddr(this, addr);
    }
    facet(facet) {
        if (this.trackAccess)
            addValue(this.trackAccess, facet);
        let addr = this.config.address[facet.id];
        if (addr == null)
            return facet.default;
        ensureAddr(this, addr);
        return getAddr(this, addr);
    }
    update(spec) {
        return resolveTransaction(this, spec);
    }
    applyTransaction(tr) {
        let conf = this.config, { base, compartments } = conf;
        for (let effect of tr.effects) {
            if (effect.is(GardState.Compartment.reconfigureCompartment)) {
                if (conf) {
                    compartments = new Map;
                    conf.compartments.forEach((val, key) => compartments.set(key, val));
                    conf = null;
                }
                compartments.set(effect.value.compartment, effect.value.extension);
            }
            else if (effect.is(GardState.reconfigure)) {
                conf = null;
                base = effect.value;
            }
            else if (effect.is(GardState.appendConfig)) {
                conf = null;
                base = asArray(base).concat(effect.value);
            }
        }
        let startValues, doc = tr.newDoc;
        if (!conf) {
            conf = GardState.Configuration.resolve(base, compartments, this);
            let intermediateState = new GardState(conf, this.doc, this.selection, conf.dynamicSlots.map(() => null), (state, slot) => slot.reconfigure(state, this), null);
            startValues = intermediateState.values;
            if (conf.staticFacet(GardState.schemaElement) != this.facet(GardState.schemaElement)) {
                let schema = conf.schema;
                if (schema)
                    doc = schema.doc(doc.content);
            }
        }
        else {
            startValues = tr.startState.values.slice();
        }
        new GardState(conf, doc, tr.newSelection, startValues, (state, slot) => slot.update(state, tr), tr);
    }
    recordAccess(slots, f) {
        let prev = this.trackAccess;
        this.trackAccess = slots;
        let result = f(this);
        this.trackAccess = prev;
        return result;
    }
    textblockMap(node) {
        return TextblockMap.get(node.start, node.node, this.textblockLTR(node.node));
    }
    toJSON(fields) {
        let result = {
            doc: this.doc.toJSON(),
            selection: this.selection.toJSON(this)
        };
        if (fields)
            for (let prop in fields) {
                let value = fields[prop];
                if (value instanceof GardState.Field && this.config.address[value.id] != null)
                    result[prop] = value.spec.toJSON(this.field(fields[prop]), this);
            }
        return result;
    }
    static fromJSON(json, extensions, fields) {
        if (!json)
            throw new ValidationError("Invalid JSON representation for GardState");
        let fieldInit = [];
        if (fields)
            for (let prop in fields) {
                if (Object.prototype.hasOwnProperty.call(json, prop)) {
                    let field = fields[prop], value = json[prop];
                    fieldInit.push(field.init(state => field.spec.fromJSON(value, state)));
                }
            }
        let config = GardState.Configuration.create([extensions, fieldInit]);
        let schema = config.schema;
        if (!schema)
            throw new SchemaError("No document plot provided to GardState.fromJSON");
        let doc = schema.docFromJSON(json.doc);
        return GardState.fromConfig(config, doc, GardSelection.fromJSON({ config, doc }, json.selection));
    }
    static fromConfig(config, doc, selection) {
        selection.check(config, doc);
        return new GardState(config, doc, selection, config.dynamicSlots.map(() => null), (state, slot) => slot.create(state), null);
    }
    get readOnly() { return this.facet(GardState.readOnly); }
    get textLTR() { return this.config.textLTR; }
    textblockLTR(plot) { return this.config.textblockLTR(plot); }
    wordAt(pos, bias = 1) {
        return wordAt(this, pos, bias);
    }
    static reconfigure = /*@__PURE__*/Transaction.Effect.define();
    static appendConfig = /*@__PURE__*/Transaction.Effect.define();
}
;GardState = /*@__PURE__*/(function (GardState) {
    class Field {
        id;
        createF;
        updateF;
        compareF;
        spec;
        provides = undefined;
        constructor(
        id, createF, updateF, compareF, 
        spec) {
            this.id = id;
            this.createF = createF;
            this.updateF = updateF;
            this.compareF = compareF;
            this.spec = spec;
        }
        static define(config) {
            let field = new GardState.Field(nextID++, config.create, config.update, config.compare || ((a, b) => a === b), config);
            if (config.provide)
                field.provides = config.provide(field);
            return field;
        }
        create(state) {
            let init = state.facet(initField).find(i => i.field == this);
            return (init?.create || this.createF)(state);
        }
        slot(addresses) {
            let idx = addresses[this.id] >> 1;
            return {
                create: (state) => {
                    state.values[idx] = this.create(state);
                    return 1;
                },
                update: (state, tr) => {
                    let oldVal = state.values[idx];
                    let value = this.updateF(oldVal, tr);
                    if (this.compareF(oldVal, value))
                        return 0;
                    state.values[idx] = value;
                    return 1;
                },
                reconfigure: (state, oldState) => {
                    if (oldState.config.address[this.id] != null) {
                        state.values[idx] = oldState.field(this);
                        return 0;
                    }
                    state.values[idx] = this.create(state);
                    return 1;
                }
            };
        }
        get extension() { return this; }
        init(create) {
            return [this, initField.of({ field: this, create })];
        }
    }
    GardState.Field = Field;
    class Facet {
        combine;
        compareInput;
        compare;
        isStatic;
        id = nextID++;
        default;
        extensions;
        constructor(
        combine, 
        compareInput, 
        compare, 
        isStatic, enables) {
            this.combine = combine;
            this.compareInput = compareInput;
            this.compare = compare;
            this.isStatic = isStatic;
            this.default = combine(none);
            this.extensions = typeof enables == "function" ? enables(this) : enables;
        }
        get reader() { return this; }
        static define(config = {}) {
            return new GardState.Facet(config.combine || ((a) => a), config.compareInput || ((a, b) => a === b), config.compare || (!config.combine ? sameArray : (a, b) => a === b), !!config.static, config.enables);
        }
        of(value) {
            return new FacetProvider(none, this, 1, value);
        }
        compute(get) {
            if (this.isStatic)
                throw new Error("Can't compute a static facet");
            return new FacetProvider([], this, 4, get);
        }
        computeN(get) {
            if (this.isStatic)
                throw new Error("Can't compute a static facet");
            return new FacetProvider([], this, 2 | 4, get);
        }
        from(field, get) {
            if (this.isStatic)
                throw new Error("Can't compute a static facet");
            if (!get)
                get = x => x;
            return new FacetProvider([field], this, 0, state => get(state.field(field)));
        }
        tag;
    }
    GardState.Facet = Facet;
    (function (Facet) {
        function combineConfig(configs, defaults,        combine = {}) {
            let result = {};
            for (let config of configs)
                for (let key of Object.keys(config)) {
                    let value = config[key], current = result[key];
                    if (current === undefined)
                        result[key] = value;
                    else if (current === value || value === undefined) ;                    else if (Object.hasOwnProperty.call(combine, key))
                        result[key] = combine[key](current, value);
                    else
                        throw new Error("Config merge conflict for field " + key);
                }
            for (let key in defaults)
                if (result[key] === undefined)
                    result[key] = defaults[key];
            return result;
        }
        Facet.combineConfig = combineConfig;
    })(Facet = GardState.Facet || (GardState.Facet = {}));
    class Configuration {
        base;
        compartments;
        dynamicSlots;
        address;
        staticValues;
        facets;
        statusTemplate = [];
        constructor(
        base, 
        compartments, 
        dynamicSlots, 
        address, 
        staticValues, 
        facets) {
            this.base = base;
            this.compartments = compartments;
            this.dynamicSlots = dynamicSlots;
            this.address = address;
            this.staticValues = staticValues;
            this.facets = facets;
            while (this.statusTemplate.length < dynamicSlots.length)
                this.statusTemplate.push(0);
        }
        staticFacet(facet) {
            if (!facet.isStatic)
                throw new Error("Only static facets can be accessed from a configuration");
            let addr = this.address[facet.id];
            return addr == null ? facet.default : this.staticValues[addr >> 1];
        }
        static resolve(base, compartments, oldState) {
            let fields = [];
            let facets = Object.create(null);
            let newCompartments = new Map();
            for (let ext of flatten(base, compartments, newCompartments)) {
                if (ext instanceof FacetProvider)
                    (facets[ext.facet.id] || (facets[ext.facet.id] = [])).push(ext);
                else
                    fields.push(ext);
            }
            let address = Object.create(null);
            let staticValues = [];
            let dynamicSlots = [];
            for (let field of fields) {
                address[field.id] = dynamicSlots.length << 1;
                dynamicSlots.push(a => field.slot(a));
            }
            let oldFacets = oldState?.config.facets;
            for (let id in facets) {
                let providers = facets[id], facet = providers[0].facet;
                let oldProviders = oldFacets && oldFacets[id] || none;
                if (providers.every(p => p.flags & 1)) {
                    address[facet.id] = (staticValues.length << 1) | 1;
                    if (sameArray(oldProviders, providers)) {
                        staticValues.push(oldState.facet(facet));
                    }
                    else {
                        let value = facet.combine(providers.map(p => p.value));
                        staticValues.push(oldState && facet.compare(value, oldState.facet(facet)) ? oldState.facet(facet) : value);
                    }
                }
                else {
                    for (let p of providers) {
                        if (p.flags & 1) {
                            address[p.id] = (staticValues.length << 1) | 1;
                            staticValues.push(p.value);
                        }
                        else {
                            address[p.id] = dynamicSlots.length << 1;
                            dynamicSlots.push(a => p.dynamicSlot(a));
                        }
                    }
                    address[facet.id] = dynamicSlots.length << 1;
                    dynamicSlots.push(a => dynamicFacetSlot(a, facet, providers));
                }
            }
            let dynamic = dynamicSlots.map(f => f(address));
            return new GardState.Configuration(base, newCompartments, dynamic, address, staticValues, facets);
        }
        static create(extensions) {
            return GardState.Configuration.resolve(extensions, new Map);
        }
        get schema() {
            let elts = this.staticFacet(GardState.schemaElement);
            if (!elts.some(elt => elt instanceof Plot.Type && elt.isDoc))
                return null;
            return Schema.define(elts);
        }
        get textLTR() { return this.staticFacet(GardState.textLTR); }
        textblockLTR(plot) {
            for (let f of this.staticFacet(GardState.textblockLTR)) {
                let result = f(plot);
                if (result != null)
                    return result;
            }
            return this.textLTR;
        }
        get visualCursorMotion() { return this.staticFacet(GardState.visualCursorMotion); }
    }
    GardState.Configuration = Configuration;
    function flatten(extension, compartments, newCompartments) {
        let result = [[], [], [], [], []];
        let seen = new Map();
        function inner(ext, prec) {
            let known = seen.get(ext);
            if (known != null) {
                if (known <= prec)
                    return;
                let found = result[known].indexOf(ext);
                if (found > -1)
                    result[known].splice(found, 1);
                if (ext instanceof CompartmentInstance)
                    newCompartments.delete(ext.compartment);
            }
            seen.set(ext, prec);
            if (Array.isArray(ext)) {
                for (let e of ext)
                    inner(e, prec);
            }
            else if (ext instanceof CompartmentInstance) {
                if (newCompartments.has(ext.compartment))
                    throw new RangeError(`Duplicate use of compartment in extensions`);
                let content = compartments.get(ext.compartment) || ext.inner;
                newCompartments.set(ext.compartment, content);
                inner(content, prec);
            }
            else if (ext instanceof PrecExtension) {
                inner(ext.inner, ext.prec);
            }
            else if (ext instanceof GardState.Field) {
                result[prec].push(ext);
                if (ext.provides)
                    inner(ext.provides, prec);
            }
            else if (ext instanceof FacetProvider) {
                result[prec].push(ext);
                if (ext.facet.extensions)
                    inner(ext.facet.extensions, 2);
            }
            else {
                let content = ext.extension;
                if (!content)
                    throw new Error(`Unrecognized extension value in extension set (${ext}). This sometimes happens because multiple instances of @codemirror/state are loaded, breaking instanceof checks.`);
                inner(content, prec);
            }
        }
        inner(extension, 2);
        return result.reduce((a, b) => a.concat(b));
    }
    GardState.prec = {
        highest: mkPrec(0),
        high: mkPrec(1),
        default: mkPrec(2),
        low: mkPrec(3),
        lowest: mkPrec(4)
    };
    class Compartment {
        constructor() { }
        static define() { return new Compartment; }
        of(ext) { return new CompartmentInstance(this, ext); }
        reconfigure(content) {
            return GardState.Compartment.reconfigureCompartment.of({ compartment: this, extension: content });
        }
        get(state) {
            return state.config.compartments.get(this);
        }
        static reconfigureCompartment = Transaction.Effect.define();
    }
    GardState.Compartment = Compartment;
    GardState.schemaElement = GardState.Facet.define({
        combine: values => values.reduce((set, elt) => set.concat(elt), none),
        static: true
    });
    GardState.readOnly = GardState.Facet.define({
        combine: values => values.length ? values[0] : false
    });
    GardState.textLTR = GardState.Facet.define({
        combine: values => values.length ? values[0] : true,
        static: true
    });
    GardState.textblockLTR = GardState.Facet.define({
        static: true
    });
    GardState.visualCursorMotion = GardState.Facet.define({
        combine(values) { return !values.length ? true : values[0]; },
        static: true
    });
;return GardState})(GardState);
const initField = /*@__PURE__*/GardState.Facet.define({ static: true });
function addValue(set, value) {
    if (set.indexOf(value) < 0)
        set.push(value);
}
function mkPrec(value) {
    return (ext) => new PrecExtension(ext, value);
}
class PrecExtension {
    inner;
    prec;
    constructor(inner, prec) {
        this.inner = inner;
        this.prec = prec;
    }
    extension;
}
function sameArray(a, b) {
    return a == b || a.length == b.length && a.every((e, i) => e === b[i]);
}
class DependencySet {
    doc = false;
    sel = false;
    schema = false;
    addrs = [];
    count = 0;
    update(deps, addresses) {
        while (this.count < deps.length) {
            let dep = deps[this.count++];
            if (dep === "doc")
                this.doc = true;
            else if (dep === "selection")
                this.sel = true;
            else if (dep === "schema")
                this.schema = true;
            else if (((addresses[dep.id] ?? 1) & 1) == 0)
                this.addrs.push(addresses[dep.id]);
        }
    }
}
class FacetProvider {
    facet;
    flags;
    value;
    id = nextID++;
    extension;    dependencies;
    constructor(dependencies, facet, flags, value) {
        this.facet = facet;
        this.flags = flags;
        this.value = value;
        this.dependencies = dependencies;    }
    dynamicSlot(addresses) {
        let getter = this.value;
        let compare = this.facet.compareInput;
        let id = this.id, idx = addresses[id] >> 1;
        let multi = this.flags & 2;
        let dependencies = this.dependencies;
        let auto = this.flags & 4 ? dependencies : null;
        let depSet = new DependencySet;
        return {
            create(state) {
                state.values[idx] = state.recordAccess(auto, getter);
                return 1;
            },
            update(state, tr) {
                depSet.update(dependencies, addresses);
                if ((depSet.doc && tr.docChanged) || (depSet.sel && (tr.docChanged || tr.selection)) ||
                    (depSet.schema && tr.startState.schema != state.schema) || ensureAll(state, depSet.addrs)) {
                    let newVal = state.recordAccess(auto, getter);
                    if (multi ? !compareArray(newVal, state.values[idx], compare) : !compare(newVal, state.values[idx])) {
                        state.values[idx] = newVal;
                        return 1;
                    }
                }
                return 0;
            },
            reconfigure(state, oldState) {
                let newVal, oldAddr = oldState.config.address[id];
                if (oldAddr != null) {
                    let oldVal = getAddr(oldState, oldAddr);
                    if (dependencies.every(dep => {
                        return dep instanceof GardState.Facet ? oldState.facet(dep) === state.facet(dep)
                            : dep instanceof GardState.Field ? oldState.field(dep, false) == state.field(dep, false)
                                : true;
                    }) || (multi ? compareArray(newVal = getter(state), oldVal, compare) : compare(newVal = getter(state), oldVal))) {
                        state.values[idx] = oldVal;
                        return 0;
                    }
                }
                else {
                    newVal = state.recordAccess(auto, getter);
                }
                state.values[idx] = newVal;
                return 1;
            }
        };
    }
}
function compareArray(a, b, compare) {
    if (a.length != b.length)
        return false;
    for (let i = 0; i < a.length; i++)
        if (!compare(a[i], b[i]))
            return false;
    return true;
}
function ensureAll(state, addrs) {
    let changed = false;
    for (let addr of addrs)
        if (ensureAddr(state, addr) & 1)
            changed = true;
    return changed;
}
function dynamicFacetSlot(addresses, facet, providers) {
    let providerAddrs = providers.map(p => addresses[p.id]);
    let dynamic = providerAddrs.filter(p => !(p & 1));
    let idx = addresses[facet.id] >> 1;
    function get(state) {
        let values = [];
        for (let i = 0; i < providerAddrs.length; i++) {
            let value = getAddr(state, providerAddrs[i]);
            if (providers[i].flags & 2)
                for (let val of value)
                    values.push(val);
            else
                values.push(value);
        }
        return facet.combine(values);
    }
    return {
        create(state) {
            for (let addr of providerAddrs)
                ensureAddr(state, addr);
            state.values[idx] = get(state);
            return 1;
        },
        update(state, tr) {
            if (!ensureAll(state, dynamic))
                return 0;
            let value = get(state);
            if (facet.compare(value, state.values[idx]))
                return 0;
            state.values[idx] = value;
            return 1;
        },
        reconfigure(state, oldState) {
            let depChanged = ensureAll(state, providerAddrs);
            let oldProviders = oldState.config.facets[facet.id], oldValue = oldState.facet(facet);
            if (oldProviders && !depChanged && sameArray(providers, oldProviders)) {
                state.values[idx] = oldValue;
                return 0;
            }
            let value = get(state);
            if (facet.compare(value, oldValue)) {
                state.values[idx] = oldValue;
                return 0;
            }
            state.values[idx] = value;
            return 1;
        }
    };
}
function ensureAddr(state, addr) {
    if (addr & 1)
        return 2;
    let idx = addr >> 1;
    let status = state.status[idx];
    if (status == 4)
        throw new Error("Cyclic dependency between fields and/or facets");
    if (status & 2)
        return status;
    state.status[idx] = 4;
    let changed = state.computeSlot(state, state.config.dynamicSlots[idx]);
    return state.status[idx] = 2 | changed;
}
function getAddr(state, addr) {
    return addr & 1 ? state.config.staticValues[addr >> 1] : state.values[addr >> 1];
}
class CompartmentInstance {
    compartment;
    inner;
    constructor(compartment, inner) {
        this.compartment = compartment;
        this.inner = inner;
    }
    extension;
}
GardSelection = /*@__PURE__*/(GardSelection => {GardSelection.selectionType = GardState.Facet.define({
    combine(values) {
        let types = [GardSelection.Text.type, GardSelection.Node.type, ...values];
        for (let i = 0; i < types.length; i++)
            for (let j = i + 1; j < types.length; j++) {
                if (types[i].tag == types[j].tag)
                    throw new Error("Duplicate selection JSON tag: " + types[i].tag);
            }
        return types;
    },
    static: true
}); return GardSelection})(GardSelection);
Transaction = /*@__PURE__*/(Transaction => {Transaction.extender = GardState.Facet.define(); return Transaction})(Transaction);
Transaction = /*@__PURE__*/(Transaction => {Transaction.appender = GardState.Facet.define(); return Transaction})(Transaction);

function scanTransaction(tr) {
    let [childList, content, marks] = tr.startState.facet(corrections);
    let plan = [];
    let queried = new Set, newNode = childList.concat(content);
    let updateWalker, { schema } = tr.startState.doc;
    let checkMarks = (node, pos, parent, index) => {
        for (let correction of marks)
            if (schema.matchNode(node.type, correction.query))
                plan.push({ node: Pos.Node.create(parent, node, pos, index), correction });
    };
    if (marks.length)
        updateWalker = {
            enterPlot: checkMarks,
            skip(node, pos, parent, index) {
                if (node.isText && !parent.node.content.includes(node)) {
                    for (let off = parent.start, i = 0;; i++) {
                        let next = parent.node.content[i], end = off + next.length;
                        if (end > pos) {
                            node = next;
                            pos = off;
                            break;
                        }
                    }
                    if (queried.has(pos))
                        return;
                    queried.add(pos);
                }
                checkMarks(node, pos, parent, index);
            },
            leavePlot() { }
        };
    let changeWalker = {
        enterPlot(node, pos, parent, index) {
            queried.add(pos);
            this.skip(node, pos, parent, index);
        },
        skip(node, pos, parent, index) {
            if (node.isPlot)
                for (let correction of newNode)
                    if (schema.matchNode(node.type, correction.query))
                        plan.push({ node: Pos.Plot.create(parent, node, pos, index), correction });
        },
        leavePlot() { }
    };
    let posA = tr.startState.doc.resolve(0), posB = tr.newDoc.resolve(0);
    for (let i = 0, { sections } = tr.changes; i < sections.length;) {
        let len = sections[i++], ins = sections[i++];
        if (ins == -1 || ins == -2 && !updateWalker) {
            if (i == sections.length)
                break;
            posA = posA.advance(len);
            posB = posB.advance(len);
        }
        else if (ins == -2) {
            while (i < sections.length && sections[i + 1] == -2) {
                len += sections[i++];
                i++;
            }
            posA = posA.advance(len);
            posB = posB.walk(len, updateWalker);
        }
        else {
            while (i < sections.length && sections[i + 1] >= 0) {
                len += sections[i++];
                ins += sections[i++];
            }
            for (let pA = posA.parent, pB = posB.parent;;) {
                if (queried.has(pB.start - 1))
                    break;
                queried.add(pB.start - 1);
                if (childList.some(c => schema.matchNode(pA.node.type, c.query))) {
                    let chA = pA.node.content, chB = pB.node.content;
                    if (chA.length != chB.length || chA.some((ch, i) => !ch.tag.eq(chB[i].tag))) {
                        for (let correction of childList)
                            if (schema.matchNode(pA.node.type, correction.query))
                                plan.push({ node: pB, correction });
                    }
                }
                for (let correction of content)
                    if (schema.matchNode(pB.node.type, correction.query))
                        plan.push({ node: pB, correction });
                if (!pB.parent)
                    break;
                pA = pA.parent;
                pB = pB.parent;
            }
            posB = posB.walk(ins, changeWalker);
            posA = posA.advance(len);
        }
    }
    return plan;
}
const corrections = /*@__PURE__*/GardState.Facet.define({
    combine(corrections) {
        let buckets = [[], [], []];
        for (let c of corrections)
            buckets[c.event].push(c);
        return buckets;
    }
});
const planCache = /*@__PURE__*/(() => new WeakMap())();
class Correction {
    event;
    query;
    correct;
    extension;
    constructor(
    event, 
    query, 
    correct) {
        this.event = event;
        this.query = query;
        this.correct = correct;
        this.extension = [
            corrections.of(this),
            Transaction.extender.of(tr => this.extend(tr))
        ];
    }
    extend(tr) {
        if (!tr.docChanged)
            return null;
        let plan = planCache.get(tr);
        if (!plan)
            planCache.set(tr, plan = scanTransaction(tr));
        let changes = [];
        for (let elt of plan)
            if (elt.correction == this) {
                let change = this.correct(elt.node, tr.startState);
                if (change)
                    changes.push(change);
            }
        return changes.length ? { changes, sequential: true } : null;
    }
    scan(state) {
        let changes = [];
        state.doc.iterate((node, pos) => {
            if (state.schema.matchNode(node.type, this.query) && (this.event == 2 || node.isPlot)) {
                let change = this.correct(state.doc.resolveNode(pos), state);
                if (change)
                    changes.push(change);
            }
        });
        if (changes.length)
            return state.update({ changes });
        return null;
    }
    static onChildList(query, correct) {
        return new Correction(0, query, correct);
    }
    static onContent(query, correct) {
        return new Correction(1, query, correct);
    }
    static onMarks(query, correct) {
        return new Correction(2, query, correct);
    }
}

export { BidiSpan, Correction, GardSelection, GardState, TextblockMap, Transaction };
