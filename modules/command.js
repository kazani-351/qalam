import { GardState, Transaction, GardSelection } from 'wordgard/state';
import { phrases } from 'wordgard/phrases';
import { Mark, ChangeSet, Leaf, Pos, Plot, Node } from 'wordgard/doc';
import { findClusterBreak } from '@marijn/find-cluster-break';
import { Alignment, Direction, Emphasis, Strong, Underline } from 'wordgard/types';

const commandHandler = /*@__PURE__*/GardState.Facet.define({
    combine(handlers) {
        let map = new Map();
        for (let [cmd, handler] of handlers) {
            let list = map.get(cmd);
            if (!list)
                map.set(cmd, list = []);
            list.push(handler);
        }
        return map;
    }
});
const Command = /*@__PURE__*/(function (Command) {
    function handler(command, handler) {
        return commandHandler.of([command, handler]);
    }
    Command.handler = handler;
    function bind(command, param) {
        return { command, param };
    }
    Command.bind = bind;
    function dispatch(wg, command, p) {
        let { command: cmd, param } = typeof command == "object" ? command : { command, param: p ?? null };
        let handlers = wg.state.facet(commandHandler).get(cmd);
        if (handlers)
            for (let handler of handlers) {
                let result = handler(wg, param);
                if (result) {
                    if (typeof result != "boolean")
                        wg.dispatch(result);
                    return true;
                }
            }
        let result = cmd(wg, param);
        if (typeof result != "boolean")
            wg.dispatch(result);
        return !!result;
    }
    Command.dispatch = dispatch;
;return Command})({});

function liftEmptyBlock(state) {
    if (!state.selection.isCursor)
        return false;
    let sel = state.sel, block = sel.head.textblockParent;
    if (!block || !sel.head.isAtStart(block) || !sel.head.isAtEnd(block))
        return false;
    let start = block.before, end = block.after, before = [], after = [];
    for (let level = block.parent, index = block.index, atStart = true, atEnd = true, first = true; level; first = false, index = level.index, level = level.parent) {
        if (!first && state.schema.canContain(level.node.type, block.node.type))
            return {
                changes: [
                    { from: start, to: block.before, insert: before },
                    { from: block.after, to: end, insert: after }
                ],
                scrollIntoView: true,
                userEvent: "unwrap.empty"
            };
        if (level.node.type.isInline || level.node.type.isolating)
            break;
        if (index)
            atStart = false;
        if (atStart)
            start--;
        else
            before.push(Plot.End);
        if (index < level.node.content.length - 1)
            atEnd = false;
        if (atEnd)
            end++;
        else
            after.unshift(level.node.tag.split(false));
    }
    return false;
}
function splitTextblock(state, splitListItem = true) {
    let { from, to } = state.sel.replacementRange, { schema } = state.doc;
    let before = from.textblockParent;
    if (!before || !before.parent)
        return false;
    let tokens = [];
    for (let p = from.parent;; p = p.parent) {
        tokens.push(Plot.End);
        if (p == before)
            break;
    }
    if (splitListItem && !before.parent.node.type.hasRole(Node.Role.List) &&
        before.isFirst && before.parent.parent?.node.type.hasRole(Node.Role.List))
        tokens.push(Plot.End, before.parent.node.tag.split(false));
    let after = to.textblockParent;
    if (after) {
        let atEnd = true, insert = tokens.length;
        for (let p = to.parent, index = to.index;; index = p.index + 1, p = p.parent) {
            if (index < p.node.content.length)
                atEnd = false;
            let tag = p.node.tag.split(atEnd), nextTag = atEnd && !p.node.type.spec.preserveOnSplitAtEnd ? null : tag;
            if (!nextTag || !schema.canContain(p.parent.node.type, tag.type)) {
                if (!atEnd)
                    return false;
                let defaultType = schema.defaultContentPlot(p.parent.node.type);
                if (defaultType)
                    tag = schema.withMarksFrom(tag, defaultType);
                else
                    return false;
            }
            tokens.splice(insert, 0, tag);
            if (p == after)
                break;
        }
    }
    let changes = [{
            from: from.pos, to: to.pos,
            insert: tokens
        }];
    if (from.isAtStart(before)) {
        let deflt = schema.defaultContentPlot(before.parent.node.type);
        if (deflt && !deflt.eq(before.node.tag))
            changes.unshift({
                from: before.before, to: before.start,
                insert: [schema.withMarksFrom(before.node.tag, deflt)]
            });
    }
    let changeSet = ChangeSet.create(state.doc, { correct: changes, local: true });
    return {
        changes: changeSet,
        selection: GardSelection.cursor(changeSet.mapPos(to.pos, 1)),
        scrollIntoView: true,
        userEvent: "split.textblock"
    };
}
function deleteSelection(state) {
    let { ranges } = state.selection;
    if (ranges.every(r => r.from == r.to))
        return false;
    return autoJoinBlocks(state, {
        changes: {
            correct: ranges.filter(r => r.from < r.to).map(r => ({ from: r.from, to: r.to, fit: true })),
            local: true
        },
        selection: (cx, changes) => state.selection instanceof GardSelection.Text
            ? GardSelection.near(cx, changes.mapPos(state.selection.head, -1), 1)
            : state.selection.map(changes, cx),
        scrollIntoView: true,
        userEvent: "delete.selection"
    });
}
function deleteEmptyTextblock(state, dir = -1) {
    if (!state.selection.isCursor)
        return false;
    let block = state.sel.head.textblockParent;
    if (!block || block.start < block.end || block.before == 0 && block.after == state.doc.length)
        return false;
    return {
        changes: { from: block.before, to: block.after, fit: true },
        selection: (cx, changes) => GardSelection.near(cx, changes.mapPos(state.selection.head), dir),
        scrollIntoView: true,
        userEvent: dir < 0 ? "delete.backward" : "delete.forward"
    };
}
function joinBackward(state) {
    if (!state.selection.isCursor)
        return false;
    let { head } = state.sel, block = head.textblockParent;
    if (!block || !head.isAtStart(block))
        return false;
    let scan = block, target = scan.node;
    while (!scan.index) {
        if (!scan.parent)
            return false;
        scan = scan.parent;
        if (scan.node.type.isolating || !scan.node.type.isBlock)
            return false;
    }
    let before = scan.previousSibling, parent = scan.parent.node, pos = scan.start - 1;
    while (before.isLeaf || !before.isTextblock) {
        if (before.isLeaf || before.type.isAtom || before.type.isolating || !before.type.isBlock)
            return false;
        let last = before.content.length - 1;
        if (last < 0)
            return false;
        parent = before;
        before = before.content[last];
        pos--;
    }
    let { schema } = state.doc;
    let changes = [
        joinBlocks(state.doc.resolve(pos - 1).parent, block),
        clearNonFitting(schema, block, before.type)
    ];
    if (!before.content.length && !before.tag.eq(target.tag) && schema.canContain(parent.type, target.type))
        changes.push({
            from: pos - before.length, to: pos - before.length + 1,
            insert: [schema.withMarksFrom(before.tag, target.tag)]
        });
    let changeSet = ChangeSet.create(state.doc, changes);
    return {
        changes: changeSet,
        selection: GardSelection.cursor(changeSet.mapPos(head.pos), -1),
        scrollIntoView: true,
        userEvent: "join.backward"
    };
}
function joinListItems(state) {
    if (!state.selection.isCursor)
        return false;
    let { head } = state.sel;
    if (head.index || head.inText)
        return false;
    for (let scan = head.parent;;) {
        let next = scan.parent;
        if (!next)
            return false;
        if (scan.node.type.isBlock && next.node.type.hasRole(Node.Role.List)) {
            const prev = scan.previousSibling;
            if (!prev || !prev.isLeaf && scan.node.content.some(ch => !state.schema.canContain(prev.type, ch.type)))
                return false;
            return {
                changes: { from: scan.before - 1, to: scan.before + 1 },
                userEvent: "join.backward.list",
                scrollIntoView: true
            };
        }
        if (scan.index)
            return false;
        scan = next;
    }
}
function joinForward(state) {
    if (!state.selection.isCursor)
        return false;
    let { head } = state.sel, block = head.textblockParent;
    if (!block || !head.isAtEnd(block))
        return false;
    let scan = block, target = scan.node;
    for (;;) {
        if (!scan.parent)
            return false;
        if (scan.index < scan.parent.node.content.length - 1)
            break;
        scan = scan.parent;
        if (scan.node.type.isolating || !scan.node.type.isBlock)
            return false;
    }
    let after = scan.nextSibling, parent = scan.parent.node, pos = scan.after;
    while (after.isLeaf || !after.isTextblock) {
        if (after.isLeaf || after.type.isolating || after.type.isAtom || !after.type.isBlock || !after.content.length)
            return false;
        parent = after;
        after = after.content[0];
        pos++;
    }
    let blockAfter = state.doc.resolveNode(pos);
    let { schema } = state.doc;
    let changes = [
        joinBlocks(block, blockAfter),
        clearNonFitting(schema, blockAfter, target.type)
    ];
    if (!target.content.length && !target.tag.eq(after.tag) && schema.canContain(parent.type, after.type))
        changes.push({
            from: block.before, to: block.start,
            insert: [schema.withMarksFrom(target.tag, after.tag)]
        });
    return {
        changes,
        scrollIntoView: true,
        userEvent: "join.forward"
    };
}
function deleteBackward(state, word = false) {
    if (!state.selection.isCursor)
        return false;
    let sel = state.sel;
    let { parent: scan, index, pos } = sel.head;
    if (!sel.head.inText)
        while (!index) {
            if (scan.node.type.isolating || !scan.parent)
                return false;
            index = scan.index;
            scan = scan.parent;
            pos--;
        }
    let next = sel.head.inText ? sel.head.nodeBefore : scan.node.content[--index];
    for (;;) {
        if (next.isPlot && next.type.isolating)
            return false;
        if (next.isLeaf || next.type.isAtom)
            break;
        let last = next.content.length - 1;
        if (last < 0)
            return false;
        next = next.content[last];
        pos--;
    }
    if (next.is(Leaf.Text)) {
        let size = 0;
        if (word) {
            for (let i = next.param.length, type;;) {
                let ch = next.param[i - 1];
                if (/\s/.test(ch)) {
                    if (type)
                        break;
                }
                else {
                    let next = /[\p{Alphabetic}\p{Number}]/u.test(ch) ? "a" : "p";
                    if (!type)
                        type = next;
                    else if (type != next)
                        break;
                }
                i--;
                size++;
                if (i == 0) {
                    if (!index)
                        break;
                    next = scan.node.content[--index];
                    if (!next.is(Leaf.Text))
                        break;
                    i = next.param.length;
                }
            }
        }
        else {
            size = next.length - findClusterBreak(next.param, next.length, false);
        }
        return {
            changes: { from: pos - size, to: pos },
            scrollIntoView: true,
            userEvent: "delete.backward"
        };
    }
    let from = pos - next.length, to = pos;
    let parent = state.doc.resolve(pos).parent;
    while (parent && parent.node.type.isBlock && parent.node.content.length == 1) {
        if (!parent.parent)
            return false;
        parent = parent.parent;
        from--;
        to++;
    }
    return {
        changes: { from, to },
        scrollIntoView: true,
        userEvent: "delete.backward"
    };
}
function deleteForward(state, word = false) {
    if (!state.selection.isCursor)
        return false;
    let sel = state.sel;
    let { parent: scan, index, pos } = sel.head;
    if (!sel.head.inText)
        while (index == scan.node.content.length) {
            if (scan.node.type.isolating || !scan.parent)
                return false;
            index = scan.index + 1;
            scan = scan.parent;
            pos++;
        }
    let next = sel.head.inText ? sel.head.nodeAfter : scan.node.content[index];
    for (;;) {
        if (next.isPlot && next.type.isolating)
            return false;
        if (next.isLeaf || next.type.isAtom)
            break;
        if (!next.content.length)
            return false;
        next = next.content[0];
        pos++;
    }
    if (next.is(Leaf.Text)) {
        let size = 0;
        if (word) {
            for (let i = 0, type;;) {
                let ch = next.param[i];
                if (/\s/.test(ch)) {
                    if (type)
                        break;
                }
                else {
                    let next = /[\p{Alphabetic}\p{Number}]/u.test(ch) ? "a" : "p";
                    if (!type)
                        type = next;
                    else if (type != next)
                        break;
                }
                i++;
                size++;
                if (i == next.param.length) {
                    if (index == scan.node.content.length - 1)
                        break;
                    next = scan.node.content[++index];
                    if (!next.is(Leaf.Text))
                        break;
                    i = 0;
                }
            }
        }
        else {
            size = findClusterBreak(next.param, 0);
        }
        return {
            changes: { from: pos, to: pos + size },
            scrollIntoView: true,
            userEvent: "delete.forward"
        };
    }
    let from = pos, to = pos + next.length;
    let parent = state.doc.resolve(pos).parent;
    while (parent && parent.node.type.isBlock && parent.node.content.length == 1) {
        if (!parent.parent)
            return false;
        parent = parent.parent;
        from--;
        to++;
    }
    return {
        changes: { from, to },
        scrollIntoView: true,
        userEvent: "delete.forward"
    };
}
function selectedTextblocks(state) {
    let textblocks = [], lastBlock = -1;
    for (let { from, to } of state.selection.ranges) {
        state.doc.iterate(from, to, (node, pos, parent) => {
            if (node.isPlot && node.isTextblock && pos > lastBlock) {
                textblocks.push(state.doc.resolveNode(pos));
                lastBlock = pos;
            }
        });
    }
    return textblocks;
}
function clearNonFitting(schema, node, type) {
    let changes = [];
    for (let i = 0, pos = node.start; i < node.node.content.length; i++) {
        let child = node.node.content[i], end = pos + child.length;
        if (!schema.canContain(type, child.type))
            changes.push({ from: pos, to: end });
        pos = end;
    }
    return changes;
}
function findWrappable(from, to, wrapper) {
    let dFrom = from.depth, dTo = to.depth;
    let pFrom = from.parent, pTo = to.parent;
    while (dFrom > dTo) {
        pFrom = pFrom.parent;
        dFrom--;
    }
    while (dTo > dFrom) {
        pTo = pTo.parent;
        dTo--;
    }
    let { schema } = from.doc;
    for (;;) {
        if (!pFrom.parent || pFrom.node.type.isolating)
            return null;
        if (pFrom.parent.start == pTo.parent.start && schema.canContain(pFrom.parent.node.type, wrapper.type))
            break;
        pFrom = pFrom.parent;
        pTo = pTo.parent;
    }
    for (let i = pFrom.index; i < pTo.index + 1; i++) {
        let ch = pFrom.parent.node.content[i];
        if (!schema.findWrapping(wrapper.type, ch.type))
            return null;
    }
    return { from: Pos.create(pFrom.parent, pFrom.before, pFrom.index, 0),
        to: Pos.create(pFrom.parent, pTo.after, pTo.index + 1, 0) };
}
function wrapBlockRange(range, wrapper) {
    let changes = [], parent = range.from.parent.node;
    for (let i = range.from.index, openWrappers = 0, pos = range.from.pos;; i++) {
        let tokens = [];
        for (let j = 0; j < openWrappers; j++)
            tokens.push(Plot.End);
        if (i == range.from.index) {
            tokens.push(wrapper);
        }
        else if (i == range.to.index) {
            tokens.push(Plot.End);
            changes.push({ from: pos, insert: tokens });
            break;
        }
        let child = parent.content[i];
        let { schema } = range.from.doc;
        let wrapping = schema.findWrapping(wrapper.type, child.type);
        for (let tag of wrapping)
            tokens.push(tag);
        openWrappers = wrapping.length;
        changes.push({ from: pos, insert: tokens });
        pos += child.length;
    }
    return changes;
}
function textblockChild(schema, type) {
    let wrap = schema.findWrapping(type, Leaf.Text);
    return wrap && wrap.length == 1 ? wrap[0] : null;
}
function findUnwrappable(schema, from, to, query) {
    let dFrom = from.depth, dTo = to.depth;
    let fromStart = from.parent.node.inlineContent ? from.parent.start : from.pos;
    let fromTextblock = from.textblockParent?.node.type;
    let toEnd = to.parent.node.inlineContent ? to.parent.end : to.pos;
    let innerCandidates = [];
    let outerCandidates = [];
    let { doc } = from;
    doc.iterate(fromStart, toEnd, (node, p, parent) => {
        if (node.type.isBlock && node.isPlot && !node.inlineContent && parent &&
            (fromTextblock ? doc.schema.canContain(parent.type, fromTextblock) : textblockChild(doc.schema, parent.type)) &&
            (!query || schema.matchNode(node.type, query))) {
            let pos = doc.resolveNode(p), depth = pos.depth;
            if (pos.before >= fromStart - (dFrom - depth + 1) && pos.after <= toEnd + (dTo - depth + 1))
                innerCandidates.push(pos);
            else
                outerCandidates.push(pos);
        }
    });
    let candidates = innerCandidates.length
        ? innerCandidates.sort((a, b) => (b.after - b.before) - (a.after - a.before))
        : outerCandidates.sort((a, b) => (a.after - a.before) - (b.after - b.before));
    if (!candidates.length)
        return null;
    for (let i = 1; i < candidates.length; i++) {
        let cur = candidates[i];
        for (let j = 0; j < i; j++) {
            let other = candidates[j];
            if (cur.after > other.before && cur.before < other.after) {
                candidates.splice(i--, 1);
                break;
            }
        }
    }
    return candidates;
}
function doUnwrapBlock(block, from, to) {
    let changes = [], { schema } = block.doc;
    let outer = block.parent.node, wrapText = textblockChild(schema, outer.type);
    let gapStart = block.before;
    let skippedDepth = 0;
    let replaceGap = (to, tokens) => {
        for (let i = 0; i < skippedDepth; i++)
            tokens.unshift(Plot.End);
        skippedDepth = 0;
        if (to > gapStart || tokens.length)
            changes.push({ from: gapStart, to, insert: tokens });
    };
    let parent = block, index = 0, pos = block.start;
    for (;;) {
        if (index == parent.node.content.length) {
            if (parent == block) {                let tokens = [];
                if (gapStart == block.before && outer.content.length == 1) {
                    let deflt = schema.createDefault(outer.type);
                    if (deflt)
                        tokens.push(deflt);
                }
                replaceGap(block.after, tokens);
                break;
            }
            else {                if (gapStart == pos && skippedDepth > 0) {
                    gapStart++;
                    skippedDepth--;
                }
                pos++;
                index = parent.index + 1;
                parent = parent.parent;
            }
        }
        else {
            let next = parent.node.content[index];
            if (schema.canContain(outer.type, next.type) || wrapText && next.isPlot && next.inlineContent) {
                if (from != null && pos + next.length <= from) {                    pos += next.length;
                    gapStart = pos;
                    skippedDepth = 1;
                    for (let cx = parent; cx != block; cx = cx.parent)
                        skippedDepth++;
                    index++;
                }
                else if (to != null && pos >= to) {                    let tokens = [], upto = pos;
                    for (let cx = parent, i = tokens.length, atStart = !index;; cx = cx.parent) {
                        if (cx.index > 0)
                            atStart = false;
                        if (atStart)
                            upto--;
                        else
                            tokens.splice(i, 0, cx.node.tag.split(false));
                        if (cx == block)
                            break;
                    }
                    replaceGap(upto, tokens);
                    break;
                }
                else {
                    if (schema.canContain(outer.type, next.type)) {
                        replaceGap(pos, []);
                    }
                    else {
                        replaceGap(pos + 1, [wrapText]);
                        changes.push(clearNonFitting(schema, Pos.Plot.create(parent, next, pos, index), wrapText.type));
                    }
                    pos += next.length;
                    index++;
                    gapStart = pos;
                }
            }
            else if (next.isLeaf || next.type.isolating) {
                pos += next.length;
                index++;
            }
            else {
                parent = Pos.Plot.create(parent, next, pos, index);
                index = 0;
                pos++;
            }
        }
    }
    return changes;
}
function joinBlocks(before, after) {
    let changes = [{ from: before.end, to: after.start }];
    let dBefore = before.depth, dAfter = after.depth;
    let tokensAfter = [], posAfter = after.after, end = posAfter;
    if (dBefore > dAfter) {
        let extraContext = [];
        for (let i = dBefore - dAfter, level = before.parent; i > 0; i--, level = level.parent)
            extraContext.push(level.node.tag);
        let nodeAfter = after.nextSibling;
        for (let i = dBefore - dAfter - 1, joining = true; i >= 0; i--) {
            let context = extraContext[i];
            if (!joining || !nodeAfter || nodeAfter.isLeaf || nodeAfter.type != context.type || !context.type.spec.autoJoin ||
                (typeof context.type.spec.autoJoin == "function" && !context.type.spec.autoJoin(context, nodeAfter.tag)))
                joining = false;
            if (joining)
                end++;
            else
                tokensAfter.push(Plot.End);
        }
    }
    else if (dAfter > dBefore) {
        for (let i = dAfter - dBefore, level = after, atEnd = true; i > 0; i--, level = level.parent) {
            if (level.nextSibling)
                atEnd = false;
            if (atEnd)
                end++;
            else
                tokensAfter.push(level.parent.node.tag);
        }
    }
    if (tokensAfter.length || end > posAfter)
        changes.push({ from: posAfter, to: end, insert: tokensAfter });
    return changes;
}
function canAddMarkInRange(doc, from, to, mark) {
    let found = false, type = mark instanceof Mark.Type ? mark : mark.type;
    doc.iterate(from, to, node => {
        if (found || mark.isInSet(node.tag.marks))
            return false;
        if (doc.schema.markAllowed(type, node.type))
            found = true;
        return true;
    });
    return found;
}
function autoJoinBlocks(state, tr) {
    if (!tr.changes)
        return tr;
    let changes = ChangeSet.create(state.doc, tr.changes), doc = changes.apply(state.doc);
    if (changes.empty)
        return tr;
    let append = [];
    let cursor = doc.resolve(0), check = (pos) => {
        cursor = cursor.advance(pos - cursor.pos);
        let before = cursor.nodeBefore, after = cursor.nodeAfter;
        if (before && after && before.isPlot && before.type.isBlock && after.isPlot && after.type == before.type) {
            let { autoJoin } = after.type.spec;
            if (autoJoin && (typeof autoJoin != "function" || autoJoin(before.tag, after.tag))) {
                let from = pos - 1, to = pos + 1;
                for (;;) {
                    let last = before.lastChild, first = after.firstChild;
                    if (!first || !last || first.isLeaf || last.isLeaf || first.type != last.type || first.type.isInline)
                        break;
                    autoJoin = last.type.spec.autoJoin;
                    if (!autoJoin || (typeof autoJoin == "function" && !autoJoin(last.tag, first.tag)))
                        break;
                    from--, to++;
                    before = last;
                    after = first;
                }
                append.push({ from, to });
            }
        }
    };
    changes.iterGaps(() => { }, (_fromA, _toA, fromB, toB) => {
        check(fromB);
        if (toB > fromB)
            check(toB);
    });
    if (!append.length)
        return { ...tr, changes };
    return Transaction.merge(state, tr, { changes: append, sequential: true });
}

const insertText = ({ state }, { from, to, insert, userEvent }) => {
    let { selection } = state;
    let marks = (from == selection.from && to == selection.to && state.sel.activeMarks) ||
        state.doc.resolve(from).marks(state.doc.resolve(to));
    return {
        changes: { from, to, insert: [Leaf.Text.of(insert, marks)], fit: true },
        scrollIntoView: true,
        selection: (cx, changes) => GardSelection.near(cx, changes.mapPos(to, 1), -1),
        userEvent
    };
};
const insertLineBreak = ({ state }) => {
    let { doc, sel } = state;
    let brk = doc.schema.lineBreak, parent = sel.from.parent.node.type;
    let { from, to } = state.selection.replacementRange;
    let insertBreak = brk && doc.schema.canContain(parent, brk.type);
    if (!(insertBreak || parent.preserveWhitespace && sel.to.parent.start == sel.from.parent.start))
        return false;
    let insert = insertBreak ? brk.withMarks(state.sel.activeMarks) : Leaf.text("\n", state.sel.activeMarks);
    let changes = ChangeSet.create(state.doc, { from, to, insert: [insert], fit: true });
    let pos = changes.findInserted(t => insertBreak ? t.type == brk.type : t.isText);
    return {
        changes,
        selection: GardSelection.cursor(pos == null ? from : pos + 1, -1),
        scrollIntoView: true,
        userEvent: insertBreak ? "insert.linebreak" : "input"
    };
};
const enter = ({ state }) => {
    let { sel, doc } = state;
    if (!sel.head.parent.node.inlineContent || !sel.anchor.parent.node.inlineContent) {
        let { from, to } = sel.replacementRange;
        let wrap = doc.schema.findWrapping(from.parent.node.type, Leaf.Text);
        if (!wrap)
            return false;
        let content = [];
        for (let i = wrap.length - 1; i >= 0; i--)
            content = [wrap[i].create(content)];
        let changes = ChangeSet.create(state.doc, { from: from.pos, to: to.pos, insert: content, fit: true });
        let placed = content.length ? changes.findInserted(t => t == content[0].tag) : null;
        return {
            changes,
            selection: placed != null ? (cx => GardSelection.near(cx, placed + wrap.length, -1)) : undefined,
            scrollIntoView: true,
            userEvent: "insert.textblock"
        };
    }
    return liftEmptyBlock(state) || splitTextblock(state);
};
const deleteUnit = ({ state }, dir) => {
    return deleteSelection(state) || (dir == "forward"
        ? joinForward(state) || deleteForward(state) || deleteEmptyTextblock(state, 1)
        : joinListItems(state) || joinBackward(state) || deleteBackward(state) || deleteEmptyTextblock(state, -1));
};
const deleteWord = ({ state }, dir) => {
    return deleteSelection(state) || (dir == "forward"
        ? joinForward(state) || deleteForward(state, true) || deleteEmptyTextblock(state, 1)
        : joinListItems(state) || joinBackward(state) || deleteBackward(state, true) || deleteEmptyTextblock(state, -1));
};
const deleteToLineEnd = (wg, dir) => {
    let tr = deleteSelection(wg.state), { selection } = wg.state;
    if (tr)
        return (wg.dispatch(tr), true);
    if (!(selection instanceof GardSelection.Text))
        return false;
    let end = wg.moveToLineBoundary(selection, dir == "forward");
    if (!end || end.head == selection.head)
        return false;
    return {
        changes: { correct: dir == "forward" ? { from: selection.head, to: end.head } : { from: end.head, to: selection.head } },
        scrollIntoView: true,
        userEvent: "delete." + dir
    };
};
const deleteLine = wg => {
    let tr = deleteSelection(wg.state), { selection } = wg.state;
    if (tr)
        return (wg.dispatch(tr), true);
    if (!(selection instanceof GardSelection.Text))
        return false;
    let start = wg.moveToLineBoundary(selection, false), end = wg.moveToLineBoundary(selection, true);
    if (!start || !end || start.head >= end.head)
        return false;
    return {
        changes: { correct: { from: start.head, to: end.head } },
        scrollIntoView: true,
        userEvent: "delete.line"
    };
};
const transposeChars = ({ state }) => {
    if (!state.selection.isCursor)
        return false;
    let { sel } = state, head = state.selection.head;
    let before = sel.head.nodeBefore, after = sel.head.nodeAfter;
    if (!before || !before.is(Leaf.Text) || !after || !after.is(Leaf.Text))
        return false;
    let lenBefore = before.param.length - findClusterBreak(before.param, before.param.length, false);
    let lenAfter = findClusterBreak(after.param, 0);
    return {
        changes: [{ from: head - lenBefore, to: head },
            { from: head + lenAfter, insert: [Leaf.text(before.param.slice(before.param.length - lenBefore))] }],
        selection: GardSelection.cursor(head + lenAfter, -1),
        scrollIntoView: true,
        userEvent: "transpose"
    };
};
const setTextblockType = ({ state }, tag) => {
    let changes = [], { schema } = state.doc;
    for (let block of selectedTextblocks(state)) {
        if (!block.node.tag.eq(tag) && block.parent && schema.canContain(block.parent.node.type, tag.type)) {
            changes.push({ from: block.before, to: block.before + 1, insert: [schema.withMarksFrom(block.node.tag, tag)] });
            changes.push(clearNonFitting(schema, block, tag.type));
        }
    }
    if (!changes.length)
        return false;
    return autoJoinBlocks(state, { changes, scrollIntoView: true, userEvent: "settype" });
};
const unwrapBlock = ({ state }, query) => {
    let targets = [], changes = [];
    for (let { from, to } of state.selection.ranges) {
        if (!targets.some(t => t.after > from && t.before < to)) {
            let result = findUnwrappable(state.schema, state.doc.resolve(from), state.doc.resolve(to), query ?? undefined);
            if (result)
                for (let node of result) {
                    targets.push(node);
                    changes.push(doUnwrapBlock(node, from, to));
                }
        }
    }
    if (!targets.length)
        return false;
    return autoJoinBlocks(state, {
        changes,
        scrollIntoView: true,
        userEvent: "unwrap"
    });
};
const wrapBlock = ({ state }, wrapper) => {
    let changes = [], lastTo = -1;
    for (let { from, to } of state.selection.ranges) {
        let range = findWrappable(state.doc.resolve(from), state.doc.resolve(to), wrapper);
        if (!range || range.from.pos < lastTo)
            continue;
        changes.push(wrapBlockRange(range, wrapper));
        lastTo = range.to.pos;
    }
    if (!changes.length)
        return false;
    return autoJoinBlocks(state, { changes, scrollIntoView: true, userEvent: "wrap" });
};
const toggleBlock = (target, tag) => {
    return unwrapBlock(target, tag) || wrapBlock(target, tag);
};
const toggleMark = ({ state }, mark) => {
    let { selection, doc } = state;
    if (selection instanceof GardSelection.Text && selection.empty) {
        let selMarks = selection.marks || state.sel.head.marks(), add = !mark.isInSet(selMarks);
        let newMarks = add ? mark.addToSet(selMarks) : mark.removeFromSet(selMarks);
        return {
            selection: GardSelection.Text.create({ anchor: selection.anchor, headSide: selection.headSide,
                goalColumn: selection.goalColumn, marks: newMarks }),
            userEvent: add ? "mark.add" : "mark.remove"
        };
    }
    else if (selection.ranges.some(r => canAddMarkInRange(doc, r.from, r.to, mark))) {
        return {
            changes: selection.ranges.map(r => ({ from: r.from, to: r.to, add: mark })),
            userEvent: "mark.add"
        };
    }
    else {
        return {
            changes: selection.ranges.map(r => ({ from: r.from, to: r.to, remove: mark })),
            userEvent: "mark.remove"
        };
    }
};
const toggleEmphasis = target => toggleMark(target, Emphasis);
const toggleStrong = target => toggleMark(target, Strong);
const toggleUnderline = target => toggleMark(target, Underline);
const setAlignment = ({ state }, align) => {
    let { schema } = state.doc;
    if (!schema.has(Alignment))
        return false;
    if (align == "start")
        align = null;
    if (align == "left" || align == "right")
        align = ltrAtCursor(state) == (align == "left") ? null : "end";
    let changes = [];
    for (let block of selectedTextblocks(state)) {
        let cur = block.node.tag.mark(Alignment);
        if (cur != align && schema.markAllowed(Alignment, block.node.type))
            changes.push(align ? { from: block.before, add: Alignment.of(align) } : { from: block.before, remove: Alignment.of(cur) });
    }
    if (!changes.length)
        return false;
    return {
        changes,
        userEvent: "mark.set.alignment",
    };
};
const setDirection = ({ state }, dir) => {
    let { schema } = state.doc;
    if (!schema.has(Direction))
        return false;
    let changes = [];
    for (let block of selectedTextblocks(state)) {
        let cur = block.node.tag.mark(Direction);
        if (cur != dir && schema.markAllowed(Direction, block.node.type))
            changes.push(dir ? { from: block.before, add: Direction.of(dir) } : { from: block.before, remove: Direction.of(cur) });
    }
    if (!changes.length)
        return false;
    return {
        changes,
        userEvent: "mark.set.direction",
    };
};
const toggleList = ({ state }, listTag) => {
    let blocks = selectedTextblocks(state);
    if (!blocks.length)
        return false;
    return addList(state, blocks, listTag) || removeList(state, blocks, listTag);
};
const listIsActive = (listTag) => state => {
    return selectedTextblocks(state).every(b => {
        let item = isListItem(b);
        return item && item.parent.node.type == listTag.type;
    });
};
function isListItem(node) {
    for (let first = true;;) {
        let { parent } = node;
        if (!parent)
            return null;
        if (parent.node.tag.type.hasRole(Node.Role.List))
            return first ? node : null;
        first = node.isFirst;
        node = parent;
    }
}
function autoJoin(a, b) {
    let { autoJoin } = a.type.spec;
    return typeof autoJoin == "function" ? autoJoin(a, b) : typeof autoJoin == "boolean" ? autoJoin : a.eq(b);
}
function addList(state, blocks, listTag) {
    let plan = [];
    let chBefore = new Set, chAfter = new Set;
    let lastItem = -1, { schema } = state.doc;
    for (let block of blocks) {
        let item = isListItem(block), wrap;
        if (!item && block.parent && schema.canContain(block.parent.node.type, listTag.type) &&
            ((wrap = schema.findWrapping(listTag.type, block.node.type)) && wrap.length == 1 ||
                (wrap = schema.findWrapping(listTag.type, Leaf.Text)) && wrap.length == 1)) {
            chAfter.add(block.before);
            chBefore.add(block.after);
            plan.push({ wrap: block, item: wrap[0] });
            lastItem = block.before;
        }
        else if (item?.parent && item.parent.node.tag.type != listTag.type &&
            schema.canContain(listTag.type, item.node.type) &&
            item.parent.parent && schema.canContain(item.parent.parent.node.type, listTag.type) &&
            item.before != lastItem) {
            chAfter.add(item.before);
            chBefore.add(item.after);
            if (item.isFirst)
                chAfter.add(item.parent.before);
            if (item.isLast)
                chBefore.add(item.parent.after);
            plan.push({ change: block, item });
            lastItem = item.before;
        }
    }
    if (!plan.length)
        return false;
    let changes = [];
    for (let step of plan) {
        if ("wrap" in step) {            let { wrap, item } = step, prev, next;
            let openTo = item.isTextblock ? wrap.start : wrap.before, openFrom = wrap.before, open = [item];
            if (chBefore.has(wrap.before)) ;            else if ((prev = wrap.previousSibling) && prev.tag.eq(listTag))
                openFrom--;            else
                open.unshift(listTag);            changes.push({ from: openFrom, to: openTo, insert: open });
            let closeFrom = item.isTextblock ? wrap.end : wrap.after, closeTo = wrap.after, close = [Plot.End];
            if (chAfter.has(wrap.after)) ;            else if ((next = wrap.nextSibling) && next.isPlot && next.type == listTag.type && autoJoin(next.tag, listTag))
                closeTo++;            else
                close.push(Plot.End);            changes.push({ from: closeFrom, to: closeTo, insert: close });
        }
        else {            let { item } = step, prev, next;
            if (item.isFirst) {
                if (chBefore.has(item.before - 1))                    changes.push({ from: item.before - 1, to: item.before });
                else if ((prev = item.parent.previousSibling) && prev.tag.type == listTag.type)                    changes.push({ from: item.before - 2, to: item.before });
                else                    changes.push({ from: item.before - 1, to: item.before, insert: [listTag] });
            }
            else if (!chBefore.has(item.before)) {                changes.push({ from: item.before, insert: [Plot.End, listTag] });
            }
            if (item.isLast) {
                if (chAfter.has(item.after + 1)) {                    changes.push({ from: item.after, to: item.after + 1 });
                }
                else if ((next = item.parent.nextSibling) && next.isPlot && autoJoin(next.tag, listTag)) {                    changes.push({ from: item.after, to: item.after + 2 });
                }
            }
        }
    }
    return { changes, userEvent: "wrap.list" };
}
function removeList(state, blocks, listTag) {
    let plan = [], lastItem = -1;
    let chBefore = new Set, chAfter = new Set;
    let { schema } = state.doc;
    for (let block of blocks) {
        let item = isListItem(block);
        if (!item)
            continue;
        let list = item.parent, parent = list.parent, rewrap = null;
        if (parent && list.node.isPlot && list.node.type == listTag.type && item.before != lastItem &&
            (item.node.isTextblock
                ? (rewrap = schema.defaultContentPlot(parent.node.type)) && rewrap.isTextblock
                : schema.canContain(parent.node.type, block.node.type))) {
            lastItem = item.before;
            plan.push({ item, rewrap: rewrap });
            chAfter.add(item.before);
            chBefore.add(item.after);
        }
    }
    if (!plan.length)
        return false;
    let changes = [];
    for (let { item, rewrap } of plan) {
        let openFrom = item.before, openTo = item.start, open = rewrap ? [rewrap] : [];
        if (item.isFirst)
            openFrom--;
        else if (!chBefore.has(item.before))
            open.unshift(Plot.End);
        changes.push({ from: openFrom, to: openTo, insert: open });
        let closeFrom = rewrap ? item.after : item.end, closeTo = item.after, close = [];
        if (item.isLast)
            closeTo++;
        else if (!chAfter.has(item.after))
            close.push(listTag);
        changes.push({ from: closeFrom, to: closeTo, insert: close });
    }
    return { changes, userEvent: "unwrap.list" };
}
function setSelection(selection) {
    return {
        selection: selection,
        scrollIntoView: true,
        userEvent: "select"
    };
}
function ltrAtCursor(state) {
    let block = state.sel.head.textblockParent;
    return block ? state.textblockLTR(block.node) : state.textLTR;
}
function isForward(dir, state) {
    return dir == "forward" ? true : dir == "backward" ? false : (dir == "right") == ltrAtCursor(state);
}
function asTextSel(sel, forward) {
    if (sel instanceof GardSelection.Text)
        return sel;
    let { from, to } = sel.replacementRange;
    return forward ? GardSelection.range(from, to) : GardSelection.range(to, from);
}
function extendSel(base, head) {
    return GardSelection.range(base.anchor, head.head, head.headSide, head.goalColumn);
}
const moveByUnit = ({ state }, { dir, extend }) => {
    let forward = isForward(dir, state), selection = asTextSel(state.selection, forward);
    if (!selection.empty && !extend) {
        let next = selection.normalCursorAtBound(state, forward);
        return next ? setSelection(next) : false;
    }
    else {
        let next = selection.nextNormalCursor(state, forward);
        if (!next)
            return false;
        if (!extend)
            state.doc.iterate(Math.min(selection.head, next.head), Math.max(selection.head, next.head), (node, pos) => {
                if (node.isPlot)
                    return !node.type.isolating;
                if (node.type.isSelectable)
                    next = GardSelection.node(pos, node);
            });
        return setSelection(extend ? extendSel(selection, next) : next);
    }
};
const moveByWord = ({ state }, { dir, extend }) => {
    let forward = (dir == "right") == ltrAtCursor(state);
    let selection = asTextSel(state.selection, forward);
    let moved = selection.skipWord(state, forward);
    return moved ? setSelection(extend ? extendSel(selection, moved) : moved) : false;
};
function nextVertical(wg, sel, forward, distance, allowNode) {
    let next = wg.moveVertically(sel, forward, distance, allowNode);
    if (next)
        return next;
    let end = (forward ? GardSelection.atEnd : GardSelection.atStart)(wg.state);
    return end.head == wg.state.selection.head ? null : end;
}
const moveByLine = (wg, { dir, extend }) => {
    let { state } = wg, { selection } = state, forward = dir == "down";
    if (state.selection instanceof GardSelection.Node) {
        let next = !extend && state.selection.normalCursorAtBound(state, forward);
        if (next && !state.doc.resolve(next.head).parent.node.inlineContent)
            return setSelection(GardSelection.cursor(next.head, next.headSide, state.selection.goalColumn));
        selection = GardSelection.cursor(forward ? selection.to : selection.from, undefined, selection.goalColumn);
    }
    else {
        selection = asTextSel(state.selection, forward);
    }
    let moved = nextVertical(wg, selection, forward, undefined, !extend);
    return moved ? setSelection(extend ? extendSel(selection, moved) : moved) : false;
};
function pageHeight(wg) {
    let marginTop = 0, marginBottom = 0;
    for (let source of wg.state.facet(wg.constructor.coveredMargins)) {
        let margins = source(wg);
        if (margins?.top)
            marginTop = Math.max(margins?.top, marginTop);
        if (margins?.bottom)
            marginBottom = Math.max(margins?.bottom, marginBottom);
    }
    return Math.max(10, Math.min(wg.scrollDOM.clientHeight - marginTop - marginBottom, (wg.dom.ownerDocument.defaultView || window).innerHeight) - 10);
}
const moveByPage = (wg, { dir, extend }) => {
    let { state } = wg, { selection } = state, forward = dir == "down";
    let moved = selection.empty || extend ? nextVertical(wg, selection, forward, pageHeight(wg), !extend)
        : forward ? GardSelection.cursor(selection.to, -1) : GardSelection.cursor(selection.from, 1);
    return moved ? setSelection(extend ? extendSel(selection, moved) : moved) : false;
};
const moveToLineSide = (wg, { dir, extend }) => {
    let pos = wg.moveToLineBoundary(wg.state.selection, isForward(dir, wg.state));
    return pos ? setSelection(extend ? extendSel(wg.state.selection, pos) : pos) : false;
};
const moveToTextblockSide = (wg, { dir, extend }) => {
    let { state } = wg, block = state.sel.head.textblockParent;
    if (!block)
        return false;
    let pos = isForward(dir, wg.state) ? GardSelection.atEnd(state, block) : GardSelection.atStart(state, block);
    return setSelection(extend ? extendSel(wg.state.selection, pos) : pos);
};
const moveToDocSide = (target, { side, extend }) => {
    let { state } = target;
    let pos = side == "start" ? GardSelection.atStart(state) : GardSelection.atEnd(state);
    if (state.selection.empty && pos.head == state.selection.head)
        return false;
    return setSelection(extend ? extendSel(state.selection, pos) : pos);
};
const selectAll = ({ state }) => {
    return {
        selection: GardSelection.range(0, state.doc.length),
        userEvent: "select.all"
    };
};
const undo = () => false;
const redo = () => false;

const Menu = /*@__PURE__*/(function (Menu) {
    let Item;
    (function (Item) {
        class Base {
            select;
            enable;
            updateFor;
            parent;
            rank;
            description;
            extension;
            constructor(spec) {
                this.select = spec.select;
                this.enable = spec.enable;
                this.updateFor = spec.updateFor;
                this.parent = spec.parent;
                this.rank = spec.rank == null ? 100 : Math.max(0, Math.min(100, spec.rank));
                this.description = spec.description;
                let src = Menu.Item.source.of(this);
                this.extension = this.parent ? [src, this.parent] : src;
            }
        }
        Item.Base = Base;
        Item.source = GardState.Facet.define();
    })(Item = Menu.Item || (Menu.Item = {}));
    class Button extends Item.Base {
        spec;
        label;
        run;
        active;
        constructor(
        spec) {
            super(spec);
            this.spec = spec;
            this.run = spec.run;
            this.active = spec.active;
            this.label = spec.label;
        }
        static define(spec) { return new Button(spec); }
    }
    Menu.Button = Button;
    (function (Button) {
        function toggleMark$1(config) {
            let { mark, parent, rank, description, label } = config;
            return Menu.Button.define({
                run: Command.bind(toggleMark, mark),
                active(state) {
                    let { selection } = state;
                    if (selection.isCursor)
                        return !!mark.isInSet(state.sel.activeMarks);
                    else
                        return !selection.ranges.some(r => canAddMarkInRange(state.doc, r.from, r.to, mark));
                },
                parent,
                rank,
                description,
                label
            });
        }
        Button.toggleMark = toggleMark$1;
    })(Button = Menu.Button || (Menu.Button = {}));
    class CustomControl extends Item.Base {
        spec;
        render;
        setEnabled;
        constructor(
        spec) {
            super(spec);
            this.spec = spec;
            this.render = spec.render;
            this.setEnabled = spec.setEnabled;
        }
        static define(spec) { return new CustomControl(spec); }
    }
    Menu.CustomControl = CustomControl;
    class Group {
        spec;
        margin;
        parent;
        rank;
        content;
        overflow;
        extension;
        constructor(
        spec) {
            this.spec = spec;
            this.margin = !!spec.margin;
            this.extension = Item.source.of(this);
            this.parent = spec.parent;
            this.rank = spec.rank == null ? 100 : Math.max(0, Math.min(100, spec.rank));
            this.content = spec.content;
            this.overflow = spec.overflow;
        }
        static define(spec = {}) { return new Group(spec); }
        template(...content) {
            return Template.new(this, content.length ? content : ["..."]);
        }
    }
    Menu.Group = Group;
    (function (Group) {
        Group.top = Group.define();
        Group.commands = Group.define({ parent: Group.top, rank: 30 });
        Group.inline = Group.define({ parent: Group.top, rank: 50, margin: true, overflow: { at: 5 } });
        Group.block = Group.define({ parent: Group.top, rank: 70, margin: true });
        Group.insert = Group.define({ parent: Group.top, rank: 90, margin: true });
    })(Group = Menu.Group || (Menu.Group = {}));
    class Submenu extends Item.Base {
        spec;
        label;
        defaultLabel;
        arrow;
        width;
        content;
        constructor(
        spec) {
            super(spec);
            this.spec = spec;
            this.label = spec.label;
            this.defaultLabel = spec.defaultLabel;
            this.arrow = spec.arrow !== false;
            this.width = spec.width;
            this.content = spec.content;
        }
        static define(spec) { return new Submenu(spec); }
        template(...content) {
            return Template.new(this, content.length ? content : ["..."]);
        }
    }
    Menu.Submenu = Submenu;
    (function (Submenu) {
        class Resolved {
            item;
            content;
            constructor(
            item, 
            content) {
                this.item = item;
                this.content = content;
            }
            static new(item, content) { return new Resolved(item, content); }
        }
        Submenu.Resolved = Resolved;
        Submenu.textblockStyle = Menu.Submenu.define({
            defaultLabel: phrases.ref("block_style"),
            description: phrases.ref("block_style"),
            parent: Group.top,
            rank: 10,
            width: 10,
        });
    })(Submenu = Menu.Submenu || (Menu.Submenu = {}));
    class Template {
        item;
        content;
        parent;
        rank;
        constructor(
        item, 
        content) {
            this.item = item;
            this.content = content;
            this.parent = item.parent ?? null;
            this.rank = item.rank ?? 100;
        }
        static new(item, content = []) {
            return new Template(item, content);
        }
    }
    Menu.Template = Template;
    const defaultOverflow = Submenu.define({
        label: {
            icon: "M57 77a8 8 0 1 1-16 0 8 8 0 0 1 16 0m0-26a8 8 0 1 1-16 0 8 8 0 0 1 16 0m0-26a8 8 0 1 1-16 0 8 8 0 0 1 16 0"
        },
        description: phrases.ref("overflow_more"),
        arrow: false
    });
    function resolve(items, template = Group.top.template(), suppress) {
        let used = new Map();
        if (suppress)
            for (let item of suppress)
                used.set(item, 2);
        function scan(template) {
            used.set(template.item, 1);
            for (let child of template.content) {
                if (child instanceof Template)
                    scan(child);
                else if (typeof child != "string")
                    used.set(child, 1);
            }
        }
        function margin(target) {
            if (target.length && target[target.length - 1] !== "|")
                target.push("|");
        }
        function resolve(template, content, target, fromTemplate) {
            if (template instanceof Template) {
                resolve(template.item, template.content, target, true);
            }
            else {
                let wasUsed = used.get(template);
                if (fromTemplate ? wasUsed == 2 : wasUsed != null)
                    return;
                used.set(template, 2);
                if (template instanceof Submenu || template instanceof Group) {
                    if (template instanceof Group && template.margin)
                        margin(target);
                    let inner = [];
                    for (let elt of content || template.content || ["..."]) {
                        if (elt === "...") {
                            let found = items.filter(i => i.parent == template);
                            for (let item of found.sort((a, b) => (a.rank ?? 100) - (b.rank ?? 100)))
                                resolve(item, null, inner, false);
                        }
                        else {
                            resolve(elt, null, inner, fromTemplate);
                        }
                    }
                    if (inner.length) {
                        if (template instanceof Submenu) {
                            if (inner[inner.length - 1] === "|")
                                inner.pop();
                            if (inner.length)
                                target.push(Submenu.Resolved.new(template, inner));
                        }
                        else {                            if (template.overflow && inner.length > template.overflow.at) {
                                let overflow = Submenu.Resolved.new(template.overflow.wrap || defaultOverflow, inner.slice(template.overflow.at - 1).filter(e => e != "|"));
                                inner.length = template.overflow.at - 1;
                                inner.push(overflow);
                            }
                            for (let elt of inner)
                                target.push(elt);
                        }
                    }
                    if (template instanceof Group && template.margin)
                        margin(target);
                }
                else {
                    target.push(template);
                }
            }
        }
        let top = [];
        if (Array.isArray(template)) {
            for (let elt of template)
                scan(elt);
            for (let elt of template)
                resolve(elt, null, top, true);
        }
        else {
            scan(template);
            resolve(template, null, top, true);
        }
        if (top.length && top[top.length - 1] === "|")
            top.pop();
        return top;
    }
    Menu.resolve = resolve;
;return Menu})({});

export { Command, Menu, autoJoinBlocks, canAddMarkInRange, clearNonFitting, deleteBackward, deleteEmptyTextblock, deleteForward, deleteLine, deleteSelection, deleteToLineEnd, deleteUnit, deleteWord, doUnwrapBlock, enter, findUnwrappable, findWrappable, insertLineBreak, insertText, joinBackward, joinBlocks, joinForward, joinListItems, liftEmptyBlock, listIsActive, moveByLine, moveByPage, moveByUnit, moveByWord, moveToDocSide, moveToLineSide, moveToTextblockSide, redo, selectAll, selectedTextblocks, setAlignment, setDirection, setTextblockType, splitTextblock, toggleBlock, toggleEmphasis, toggleList, toggleMark, toggleStrong, toggleUnderline, transposeChars, undo, unwrapBlock, wrapBlock, wrapBlockRange };
