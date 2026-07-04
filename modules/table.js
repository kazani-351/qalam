import { Decoration, PointSet, Wordgard } from 'wordgard/editor';
import { GardState, Transaction, GardSelection, Correction } from 'wordgard/state';
import { Table, ColSpan, RowSpan, TableRow, Cell, BlockCell, HeaderCell, BlockHeaderCell } from 'wordgard/types';
import { Node, ValidationError, Token, ChangeSet } from 'wordgard/doc';
import { Command, moveByUnit, moveByWord, moveByLine, moveToLineSide, Menu } from 'wordgard/command';
import { tablePhrases } from 'wordgard/phrases';

class Rect {
    startCol;
    startRow;
    endCol;
    endRow;
    constructor(startCol, startRow, endCol,    endRow) {
        this.startCol = startCol;
        this.startRow = startRow;
        this.endCol = endCol;
        this.endRow = endRow;
    }
}
class MapData {
    table;
    width;
    height;
    map;
    problems;
    cellEnds;
    constructor(table, width, height, map, problems, cellEnds) {
        this.table = table;
        this.width = width;
        this.height = height;
        this.map = map;
        this.problems = problems;
        this.cellEnds = cellEnds;
    }
}
let cache = /*@__PURE__*/(() => new WeakMap())();
class TableMap {
    start;
    data;
    constructor(start, data) {
        this.start = start;
        this.data = data;
    }
    get width() { return this.data.width; }
    get height() { return this.data.height; }
    get table() { return this.data.table; }
    get tablePos() { return this.start - 1; }
    cellRect(pos) {
        let localPos = pos - this.start, { map, width, height } = this.data;
        for (let i = 0; i < map.length; i++)
            if (map[i] == localPos) {
                let startCol = i % width, startRow = (i / width) | 0;
                let endCol = startCol + 1, endRow = startRow + 1;
                for (let j = 1; endCol < width && map[i + j] == localPos; j++)
                    endCol++;
                for (let j = 1; endRow < height && map[i + (width * j)] == localPos; j++)
                    endRow++;
                return new Rect(startCol, startRow, endCol, endRow);
            }
        throw new RangeError(`No cell with offset ${pos} found`);
    }
    nearestCell(pos, bias) {
        let localPos = pos - this.start, after = -1, before = -1;
        let { map, cellEnds } = this.data;
        for (let i = 0; i < map.length; i++) {
            let cellPos = map[i];
            if (cellPos > 0) {
                if (cellPos >= localPos && (after < 0 || after > cellPos))
                    after = cellPos;
                if (cellPos < localPos && before < cellPos)
                    before = cellPos;
            }
        }
        if (before > -1) {
            let beforeEnd = cellEnds.get(before);
            if (beforeEnd > localPos || after < 0 || bias < 0)
                return { from: before + this.start, to: beforeEnd + this.start };
        }
        return { from: after + this.start, to: cellEnds.get(after) + this.start };
    }
    cellEnd(pos) {
        let end = this.data.cellEnds.get(pos - this.start);
        if (end == null)
            throw new Error(`No cell with offset ${pos} found`);
        return end + this.start;
    }
    rectBetween(a, b) {
        let { startCol: startColA, endCol: endColA, startRow: startRowA, endRow: endRowA } = this.cellRect(a);
        let { startCol: startColB, endCol: endColB, startRow: startRowB, endRow: endRowB } = this.cellRect(b);
        return new Rect(Math.min(startColA, startColB), Math.min(startRowA, startRowB), Math.max(endColA, endColB), Math.max(endRowA, endRowB));
    }
    cellsInRect(rect) {
        let result = [], { map, width } = this.data;
        for (let row = rect.startRow; row < rect.endRow; row++) {
            for (let col = rect.startCol; col < rect.endCol; col++) {
                let index = row * width + col, pos = map[index];
                if (pos > 0 && result.indexOf(pos + this.start) < 0 &&
                    (col != rect.startCol || !col || map[index - 1] != pos) &&
                    (row != rect.startRow || !row || map[index - width] != pos))
                    result.push(pos + this.start);
            }
        }
        return result;
    }
    cellAt(col, row) {
        let { width, map } = this.data;
        return map[col + row * width] + this.start || null;
    }
    rowPos(row) {
        let { start } = this, { table } = this.data;
        for (let r = 0; r < row; r++)
            start += table.content[r].length;
        return start;
    }
    cellInsertionPos(col, row) {
        let { width, map } = this.data;
        for (let scan = col;; scan++) {
            if (scan == width)
                return this.rowPos(row + 1) - 1;
            let index = scan + row * width, pos = map[index];
            if (pos && (!row || pos != map[index - width] && (!col || pos != map[index - 1])))
                return pos + this.start;
        }
    }
    getCell(pos) {
        let found = this.data.table.plotAt(pos - this.start);
        if (!found)
            throw new Error("Invalid cell position");
        return found;
    }
    cellsOverlapRectangle(rect) {
        let { width, height, map } = this.data;
        let indexTop = rect.startRow * width + rect.startCol, indexBefore = indexTop;
        let indexBottom = (rect.endRow - 1) * width + rect.endCol, indexAfter = indexTop + (rect.endCol - rect.startCol - 1);
        for (let i = rect.startRow; i < rect.endRow; i++) {
            if (rect.startCol > 0 && sameCell(map[indexBefore], map[indexBefore - 1]) ||
                rect.endCol < width && sameCell(map[indexAfter], map[indexAfter + 1]))
                return true;
            indexBefore += width;
            indexAfter += width;
        }
        for (let i = rect.startCol; i < rect.endCol; i++) {
            if (rect.startRow > 0 && sameCell(map[indexTop], map[indexTop - width]) ||
                rect.endRow < height && sameCell(map[indexBottom], map[indexBottom + width]))
                return true;
            indexTop++;
            indexBottom++;
        }
        return false;
    }
    static get(table, start) {
        let data = cache.get(table);
        if (!data)
            cache.set(table, data = computeMap(table));
        return new TableMap(start, data);
    }
}
function sameCell(a, b) {
    return a != 0 && a == b;
}
function computeMap(table) {
    if (table.tag != Table)
        throw new RangeError(`Not a table node: ${table.type.name}`);
    let width = table.content[0].content.reduce((w, c) => w + (c.mark(ColSpan) ?? 1), 0);
    let height = table.content.length;
    let map = [], problems = null;
    for (let i = 0, e = width * height; i < e; i++)
        map[i] = 0;
    let cellEnd = new Map();
    for (let row = 0, pos = 0; row < height; row++) {
        let rowNode = table.content[row], mapPos = row * width;
        pos++;
        for (let i = 0, col = 0;; i++) {
            while (mapPos < map.length && map[mapPos] != 0)
                mapPos++;
            if (i == rowNode.content.length)
                break;
            let cellNode = rowNode.content[i];
            cellEnd.set(pos, pos + cellNode.length);
            let colSpan = cellNode.mark(ColSpan) ?? 1, rowSpan = cellNode.mark(RowSpan) ?? 1;
            let exceed = col + colSpan - width;
            if (exceed > 0) {
                map = growMap(map, width, height, exceed);
                width += exceed;
                mapPos += row * exceed;
            }
            for (let h = 0; h < rowSpan; h++) {
                if (h + row >= height) {
                    (problems || (problems = [])).push({ type: "overlong_rowspan", pos, n: rowSpan - h });
                    break;
                }
                let start = mapPos + (h * width), collided = 0;
                for (let w = 0; w < colSpan; w++) {
                    if (map[start + w] == 0)
                        map[start + w] = pos;
                    else
                        collided++;
                }
                if (collided)
                    (problems || (problems = [])).push({ type: "collision", pos });
            }
            mapPos += colSpan;
            col += colSpan;
            pos += cellNode.length;
        }
        pos++;
    }
    for (let row = 0, i = width; row < height; row++, i += width) {
        let missing = 0;
        while (missing < width && map[i - missing - 1] == 0)
            missing++;
        if (missing)
            (problems || (problems = [])).push({ type: "missing", row, n: missing });
    }
    return new MapData(table, width, height, map, problems, cellEnd);
}
function growMap(map, width, height, count) {
    let newMap = [];
    for (let row = 0, i = 0; row < height; row++) {
        for (let col = 0; col < width; col++)
            newMap.push(map[i++]);
        for (let j = 0; j < count; j++)
            newMap.push(0);
    }
    return newMap;
}

const cellSelectionDeco = /*@__PURE__*/GardState.Field.define({
    create: getCellDeco,
    update: (deco, tr) => {
        return tr.docChanged || tr.selection ? getCellDeco(tr.state) : deco;
    },
    provide: f => Decoration.Point.source.of(s => s.field(f))
});
const selectedCell = /*@__PURE__*/Decoration.Point.attributes({ class: "wg-selected-cell" });
function getCellDeco(state) {
    if (!(state.selection instanceof CellSelection))
        return PointSet.empty;
    return PointSet.create(state.selection.ranges.map(({ from }) => [from - 1, selectedCell]));
}
const tableSelectionFilter = /*@__PURE__*/(() => GardState.prec.low(Transaction.extender.of(tr => {
    let normalized = CellSelection.normalize(tr.newSelection, tr.newDoc);
    return normalized ? { selection: normalized } : null;
})))();
function resolveDir(dir, state) {
    let block = state.sel.head.textblockParent;
    return (dir == "right") == (block ? state.textblockLTR(block.node) : state.textLTR)
        ? "forward" : "backward";
}
function cursorCommand(wg, { dir, extend }) {
    let { state } = wg, { selection } = state;
    if (!(selection instanceof CellSelection))
        return false;
    let newSel;
    if (!extend) {
        newSel = GardSelection.near(state, selection.replacementRange.from, 1);
    }
    else {
        if (dir == "left" || dir == "right")
            dir = resolveDir(dir, state);
        newSel = selection.moveHead(state.doc, dir);
        if (!newSel) {
            let forward = dir == "forward" || dir == "down";
            let table = state.sel.from.parent.parent;
            let next = GardSelection.near(state, forward ? table.after : table.before, forward ? 1 : -1);
            newSel = GardSelection.range(forward ? table.before : table.after, next.head, next.headSide);
        }
    }
    wg.dispatch({
        selection: newSel,
        scrollIntoView: true,
        userEvent: "select"
    });
    return true;
}
function moveToRowSide(wg, { dir, extend }) {
    let { state } = wg, { selection } = state;
    if (!(selection instanceof CellSelection))
        return false;
    if (dir == "left" || dir == "right")
        dir = resolveDir(dir, state);
    for (;;) {
        let next = selection.moveHead(state.doc, dir);
        if (!next)
            break;
        selection = next;
    }
    if (selection != state.selection)
        wg.dispatch({
            selection,
            scrollIntoView: true,
            userEvent: "select"
        });
    return true;
}
const cellSelectionTripleClick = /*@__PURE__*/Wordgard.mouseSelectionStyle.of((wg, event) => {
    if (event.detail == 3) {
        let pos = wg.state.doc.resolve(wg.posAtCoords({ x: event.clientX, y: event.clientY }).pos);
        let cell = pos.matchingParent(n => wg.state.schema.matchNode(n.type, Node.Group.TableCell));
        if (cell) {
            let from = cell.before, to = cell.after;
            return {
                get(event) { return CellSelection.between(wg.state.doc, from, to) || GardSelection.near(wg.state, from, 1); },
                update(update) { from = update.changes.mapPos(from, 1); to = Math.max(from, update.changes.mapPos(to, -1)); }
            };
        }
    }
    return null;
});
class CellSelection extends GardSelection {
    anchorCell;
    headCell;
    _ranges;
    anchorRange;
    constructor(anchor, head, 
    anchorCell, 
    headCell, 
    _ranges, 
    anchorRange) {
        super(anchor, head);
        this.anchorCell = anchorCell;
        this.headCell = headCell;
        this._ranges = _ranges;
        this.anchorRange = anchorRange;
    }
    get ranges() { return this._ranges; }
    get replacementRange() { return this._ranges[this.anchorRange]; }
    get domSelection() {
        let { from, to } = this.replacementRange;
        return { anchor: from, anchorSide: 1, head: to, headSide: -1 };
    }
    eq(other) {
        return other instanceof CellSelection && other.anchor == this.anchor && other.head == this.head;
    }
    map(changes, cx, assoc = -1) {
        let fromPos = changes.mapPos(this.from, 1), toPos = changes.mapPos(this.to, -1);
        let from = cx.doc.resolve(fromPos), to = cx.doc.resolve(toPos);
        let after = from.nodeAfter, before = to.nodeBefore;
        if (after && after.type == Table.type)
            fromPos += 2;
        else if (after && after.type == TableRow.type)
            fromPos++;
        if (before && before.type == Table.type)
            toPos -= 2;
        else if (before && before.type == TableRow.type)
            toPos--;
        return (this.from == this.anchor ? CellSelection.between(cx.doc, fromPos, toPos) : CellSelection.between(cx.doc, toPos, fromPos))
            || GardSelection.near(cx, changes.mapPos(this.head), assoc);
    }
    moveHead(doc, dir) {
        let head = doc.resolve(this.head), inv = this.head < this.anchor;
        let headPos = this.head - (inv ? 0 : head.nodeBefore.length);
        let table = head.parent.parent, map = TableMap.get(table.node, table.start), rect = map.cellRect(headPos);
        let anchorPos = inv ? map.nearestCell(this.anchor, -1).from : this.anchor;
        let col = dir == "backward" ? rect.startCol - 1 : dir == "forward" ? rect.endCol : rect.startCol;
        let row = dir == "up" ? rect.startRow - 1 : dir == "down" ? rect.endRow : rect.startRow;
        if (col < 0 || col >= map.width || row < 0 || row >= map.height)
            return null;
        let newHead = map.cellAt(col, row);
        if (newHead == null)
            return null;
        return newHead >= anchorPos ? CellSelection.between(doc, anchorPos, map.cellEnd(newHead))
            : CellSelection.between(doc, newHead, map.cellEnd(anchorPos));
    }
    static between(doc, anchor, head) {
        let from = doc.resolve(Math.min(anchor, head)), to = doc.resolve(Math.max(anchor, head));
        let fromCell = from.nodeAfter, toCell = to.nodeBefore, table = from.parent?.parent;
        if (anchor == head ||
            !fromCell || !doc.schema.matchNode(fromCell.type, Node.Group.TableCell) ||
            !toCell || !doc.schema.matchNode(toCell.type, Node.Group.TableCell) ||
            !table || table.start > to.pos || table.end < to.pos)
            return null;
        let toPos = to.pos - toCell.length;
        let map = TableMap.get(table.node, table.start);
        let cells = map.cellsInRect(map.rectBetween(from.pos, toPos));
        let anchorCell = anchor, headCell = head;
        if (anchor > head)
            anchorCell -= toCell.length;
        else
            headCell -= toCell.length;
        return new CellSelection(anchor, head, anchorCell, headCell, cells.map(pos => ({ from: pos + 1, to: map.cellEnd(pos) - 1 })), cells.indexOf(head - (head < anchor ? 0 : toCell.length)));
    }
    static normalize(sel, doc) {
        if (sel instanceof CellSelection)
            return null;
        let { from, to } = sel, modified = false;
        for (let parent = doc.resolve(sel.from).parent, cell = null; parent; parent = parent.parent) {
            if (doc.schema.matchNode(parent.node.type, Node.Group.TableCell))
                cell = parent;
            if (parent.node.type == Table.type) {
                if (to > parent.end) {
                    from = parent.before;
                    modified = true;
                }
                else if (!cell || to > cell.end) {
                    let map = TableMap.get(parent.node, parent.start);
                    let start = map.nearestCell(from, 1), end = map.nearestCell(to, -1);
                    if (start.from > end.from)
                        end = start;
                    return sel.anchor < sel.head
                        ? CellSelection.between(doc, start.from, end.to)
                        : CellSelection.between(doc, end.to, start.from);
                }
            }
        }
        for (let parent = doc.resolve(sel.to).parent; parent; parent = parent.parent) {
            if (parent.node.type == Table.type && from < parent.start) {
                to = parent.after;
                modified = true;
            }
        }
        return !modified ? null : sel.anchor < sel.head ? GardSelection.range(from, to) : GardSelection.range(to, from);
    }
    static extension = /*@__PURE__*/(() => [
        GardSelection.define("cell", CellSelection, sel => ({ anchor: sel.anchor, head: sel.head }), (doc, json) => {
            if (!json || typeof json.anchor != "number" || typeof json.head != "number")
                throw new ValidationError("Invalid JSON data for CellSelection");
            let sel = CellSelection.between(doc, json.anchor, json.head);
            if (!sel)
                throw new ValidationError("Cell selection from JSON doesn't span actual cells");
            return sel;
        }),
        cellSelectionDeco,
        tableSelectionFilter,
        Command.handler(moveByUnit, cursorCommand),
        Command.handler(moveByWord, cursorCommand),
        Command.handler(moveByLine, cursorCommand),
        Command.handler(moveToLineSide, moveToRowSide),
        cellSelectionTripleClick
    ])();
}

const tableCorrection = /*@__PURE__*/Correction.onContent(Table, (pos, state) => {
    let map = TableMap.get(pos.node, pos.start);
    if (!map.data.problems)
        return null;
    let mustAdd = [], changes = [];
    for (let i = 0; i < map.height; i++)
        mustAdd.push(0);
    for (let i = 0; i < map.data.problems.length; i++) {
        let prob = map.data.problems[i];
        if (prob.type == "collision") {
            let pos = prob.pos + map.start, rect = map.cellRect(pos), cell = map.getCell(pos);
            let colSpan = ColSpan.isInSet(cell.marks), rowSpan = RowSpan.isInSet(cell.marks);
            if (colSpan)
                changes.push({ from: pos, remove: colSpan });
            if (rowSpan)
                changes.push({ from: pos, remove: rowSpan });
            for (let row = rect.startRow, endRow = row + (rowSpan ? rowSpan.value : 1), first = true; row < endRow; row++) {
                for (let col = rect.startCol, endCol = col + (colSpan ? colSpan.value : 1); col < endCol; col++) {
                    if (first) {
                        first = false;
                    }
                    else if (map.cellAt(col, row) == pos) {
                        let from = pos;
                        for (let scan = 0; from == pos; scan++)
                            from = map.cellInsertionPos(col + scan, row);
                        changes.push({ from, insert: [state.schema.createAndFill(cell.type.default)] });
                    }
                }
            }
        }
        else if (prob.type == "missing") {
            mustAdd[prob.row] += prob.n;
        }
        else if (prob.type == "overlong_rowspan") {
            let cell = map.getCell(prob.pos + map.start), cur = RowSpan.isInSet(cell.marks), newVal = cur.value - prob.n;
            let from = pos.start + prob.pos;
            changes.push(newVal == 1 ? { from, remove: cur } : { from, add: RowSpan.of(newVal) });
        }
    }
    let first, last;
    for (let i = 0; i < mustAdd.length; i++)
        if (mustAdd[i]) {
            if (first == null)
                first = i;
            last = i;
        }
    for (let i = 0, curPos = pos.start; i < map.height; i++) {
        let row = pos.node.content[i], end = curPos + row.length;
        let add = mustAdd[i];
        if (add > 0) {
            let cell = state.schema.defaultContentPlot(row.tag.type);
            let nodes = [];
            for (let j = 0; j < add; j++)
                nodes.push(state.schema.createAndFill(cell));
            let side = (i == 0 || first == i - 1) && last == i ? curPos + 1 : end - 1;
            changes.push({ from: side, insert: nodes });
        }
        curPos = end;
    }
    return changes;
});

function tableContext(state, pos) {
    let table, cells;
    if (pos != null || !(state.selection instanceof CellSelection)) {
        let ref = pos != null ? state.doc.resolve(pos) : state.sel.head;
        let cellPos = ref.matchingParent(node => state.schema.matchNode(node.type, Node.Group.TableCell));
        if (cellPos && cellPos.parent?.parent) {
            table = cellPos.parent.parent;
            cells = [cellPos.before];
        }
    }
    else {
        table = state.sel.anchor.parent.parent;
        cells = state.selection.ranges.map(r => r.from - 1);
    }
    return cells ? { cells, map: TableMap.get(table.node, table.start) } : null;
}
function cellTag(schema) {
    if (schema.has(Cell))
        return Cell;
    if (schema.has(BlockCell))
        return BlockCell;
    throw new Error(`No cell type in schema`);
}
function headerCellTag(schema) {
    if (schema.has(HeaderCell))
        return HeaderCell;
    if (schema.has(BlockHeaderCell))
        return BlockHeaderCell;
    return null;
}
const toggleHeaderCell = ({ state }) => {
    let cx = tableContext(state), header = headerCellTag(state.schema);
    if (!cx || !header)
        return false;
    let cells = cx.cells.map(c => cx.map.getCell(c));
    let changes = [];
    if (cells.some(x => x.type != header.type)) {
        for (let i = 0; i < cells.length; i++) {
            let cell = cells[i], pos = cx.cells[i];
            if (cell.type != header.type)
                changes.push({ from: pos, to: pos + 1, insert: [state.schema.withMarksFrom(cell.tag, header)] });
        }
    }
    else {
        let tag = cellTag(state.schema);
        for (let i = 0; i < cells.length; i++) {
            let cell = cells[i], pos = cx.cells[i];
            if (cell.type == header.type)
                changes.push({ from: pos, to: pos + 1, insert: [state.schema.withMarksFrom(cell.tag, tag)] });
        }
    }
    return { changes };
};
function selectedRect(state, cx) {
    return state.selection instanceof CellSelection
        ? cx.map.rectBetween(state.selection.anchorCell, state.selection.headCell)
        : cx.map.cellRect(cx.cells[0]);
}
const addColumn = ({ state }, side) => {
    let cx = tableContext(state);
    if (!cx)
        return false;
    let { map } = cx, rect = selectedRect(state, cx);
    let col = side == "before" ? rect.startCol : rect.endCol;
    let changes = [], adjusted = new Set();
    for (let row = 0, pos; row < map.height; row++) {
        if (col > 0 && col < map.width && map.cellAt(col - 1, row) == (pos = map.cellAt(col, row)) && pos != null) {
            if (!adjusted.has(pos)) {
                let value = map.getCell(pos).mark(ColSpan) ?? 1;
                changes.push({ from: pos, add: ColSpan.of(value + 1) });
                adjusted.add(pos);
            }
        }
        else {
            changes.push({ from: map.cellInsertionPos(col, row), insert: [state.schema.createAndFill(cellTag(state.schema))] });
        }
    }
    return {
        changes,
        userEvent: "insert.column"
    };
};
const deleteColumn = ({ state }) => {
    let cx = tableContext(state);
    if (!cx)
        return false;
    let { map } = cx, rect = selectedRect(state, cx);
    if (rect.startCol == 0 && rect.endCol == map.width) {
        return {
            changes: { from: map.tablePos, to: map.tablePos + map.table.length, fit: true },
            selection: cx => GardSelection.near(cx, map.tablePos, -1),
            userevent: "delete.table"
        };
    }
    let changes = [], handled = new Set(), delPos = state.selection.from;
    for (let row = 0; row < map.height; row++) {
        for (let col = rect.startCol; col < rect.endCol;) {
            let cell = map.cellAt(col, row);
            if (cell == null)
                continue;
            let node = map.getCell(cell), span = node.mark(ColSpan) ?? 1;
            if (col == rect.startCol && col > 0 && map.cellAt(col - 1, row) == cell) {
                let cellRect = map.cellRect(cell);
                if (!handled.has(cell)) {
                    let newSpan = rect.startCol - cellRect.startCol + (Math.max(0, cellRect.endCol - rect.endCol));
                    changes.push(newSpan == 1 ? { from: cell, remove: ColSpan.isInSet(node.marks) }
                        : { from: cell, add: ColSpan.of(newSpan) });
                    handled.add(cell);
                }
                col = cellRect.endCol;
            }
            else if (col + span > rect.endCol) {
                if (!handled.has(cell)) {
                    let newSpan = col + span - rect.endCol;
                    changes.push(newSpan == 1 ? { from: cell, remove: ColSpan.isInSet(node.marks) }
                        : { from: cell, add: ColSpan.of(newSpan) });
                    handled.add(cell);
                }
                break;
            }
            else {
                if (!handled.has(cell)) {
                    changes.push({ from: cell, to: cell + node.length });
                    delPos = Math.min(delPos, cell);
                    handled.add(cell);
                }
                col += span;
            }
        }
    }
    return {
        changes,
        selection: cx => GardSelection.near(cx, delPos, -1),
        userEvent: "delete.column"
    };
};
const addRow = ({ state }, side) => {
    let cx = tableContext(state);
    if (!cx)
        return false;
    let { map } = cx, rect = selectedRect(state, cx);
    let row = side == "before" ? rect.startRow : rect.endRow;
    let changes = [], adjusted = new Set();
    let cellCount = map.width;
    if (row > 0 && row < map.height) {
        for (let col = 0; col < map.width; col++) {
            let above = map.cellAt(col, row - 1), below = map.cellAt(col, row);
            if (above != null && above == below) {
                cellCount--;
                if (!adjusted.has(above)) {
                    let value = map.getCell(above).mark(RowSpan);
                    changes.push({ from: above, add: RowSpan.of(value + 1) });
                    adjusted.add(above);
                }
            }
        }
    }
    let cell = state.schema.createAndFill(cellTag(state.schema)), content = [];
    for (let i = 0; i < cellCount; i++)
        content.push(cell);
    changes.push({ from: map.rowPos(row), insert: [TableRow.create(content)] });
    return {
        changes,
        userEvent: "insert.row"
    };
};
const deleteRow = ({ state }) => {
    let cx = tableContext(state);
    if (!cx)
        return false;
    let { map } = cx, rect = selectedRect(state, cx);
    if (rect.startRow == 0 && rect.endRow == map.height) {
        return {
            changes: { from: map.tablePos, to: map.tablePos + map.table.length, fit: true },
            selection: cx => GardSelection.near(cx, map.tablePos, -1),
            userEvent: "delete.table"
        };
    }
    let changes = [], handled = new Set();
    for (let col = 0; col < map.width; col++) {
        if (rect.startRow > 0) {
            let above = map.cellAt(col, rect.startRow - 1);
            if (above != null && !handled.has(above) && map.cellAt(col, rect.startRow) == above) {
                let cellRect = map.cellRect(above);
                let rowsAbove = rect.startRow - cellRect.startRow, rowsBelow = Math.max(0, cellRect.endRow - rect.endRow);
                let rows = rowsAbove + rowsBelow;
                changes.push(rows == 1 ? { from: above, remove: RowSpan.isInSet(map.getCell(above).marks) }
                    : { from: above, add: RowSpan.of(rows) });
                handled.add(above);
            }
        }
        if (rect.endRow < map.height) {
            let below = map.cellAt(col, rect.endRow);
            if (below != null && !handled.has(below) && map.cellAt(col, rect.endRow - 1) == below) {
                let cell = map.getCell(below), cellRect = map.cellRect(below);
                let rowSpan = cellRect.endRow - rect.endRow;
                changes.push({ from: below, to: below + cell.length });
                let copy = cell.withMarks(rowSpan == 1 ? RowSpan.removeFromSet(cell.marks) : RowSpan.of(rowSpan).addToSet(cell.marks));
                changes.push({ from: map.cellInsertionPos(cellRect.startCol, rect.endRow), insert: [copy] });
                handled.add(below);
            }
        }
    }
    let delPos = state.selection.from;
    for (let row = rect.startRow; row < rect.endRow; row++) {
        let rowPos = map.rowPos(row), rowNode = map.table.content[row];
        delPos = Math.min(delPos, rowPos);
        changes.push({ from: rowPos, to: rowPos + rowNode.length });
    }
    return {
        changes,
        selection: cx => GardSelection.near(cx, delPos, -1),
        userEvent: "delete.row"
    };
};
const mergeCells = ({ state }) => {
    if (!(state.selection instanceof CellSelection) || state.selection.ranges.length == 1)
        return false;
    let cx = tableContext(state);
    let { map } = cx, rect = selectedRect(state, cx);
    if (map.cellsOverlapRectangle(rect))
        return false;
    let movedContent = [], changes = [];
    for (let i = 1; i < cx.cells.length; i++) {
        let pos = cx.cells[i], node = map.getCell(pos);
        if (node.content.length && !(node.content[0].isPlot && !node.content[0].content.length))
            movedContent = movedContent.concat(node.content);
        changes.push({ from: pos, to: pos + node.length });
    }
    let pos = cx.cells[0];
    let width = rect.endCol - rect.startCol, height = rect.endRow - rect.startRow;
    if (width > 1)
        changes.push({ from: pos, add: ColSpan.of(width) });
    if (height > 1)
        changes.push({ from: pos, add: RowSpan.of(height) });
    if (movedContent.length)
        changes.push({ from: map.cellEnd(pos) - 1, insert: movedContent });
    return {
        changes,
        selection: cx => CellSelection.between(cx.doc, pos, pos + cx.doc.nodeAt(pos).length),
        userEvent: "join.cell"
    };
};
const splitCell = ({ state }) => {
    let cx = tableContext(state);
    if (!cx || cx.cells.length > 1)
        return false;
    let { map } = cx, pos = cx.cells[0], node = map.getCell(pos);
    let colSpan = ColSpan.isInSet(node.marks), rowSpan = RowSpan.isInSet(node.marks);
    if (!colSpan && !rowSpan)
        return false;
    let changes = [], rect = map.cellRect(pos), lastInsert = -1;
    for (let row = rect.startRow, first = true; row < rect.endRow; row++) {
        let insertPos = lastInsert = map.cellInsertionPos(rect.endCol, row);
        let cell = state.schema.createAndFill(node.type.default);
        for (let col = rect.startCol; col < rect.endCol; col++) {
            if (first) {
                first = false;
                continue;
            }
            changes.push({ from: insertPos, insert: [cell] });
        }
    }
    if (colSpan)
        changes.push({ from: pos, remove: colSpan });
    if (rowSpan)
        changes.push({ from: pos, remove: rowSpan });
    return {
        changes,
        selection: (cx, changes) => CellSelection.between(cx.doc, pos, changes.mapPos(lastInsert, 1)),
        userEvent: "split.cell"
    };
};

function fitSlice(schema, parent, slice, context) {
    let wrap = schema.findWrapping(schema.docTag.type, parent.type);
    if (!wrap)
        return null;
    let content = [schema.createAndFill(parent)];
    for (let i = wrap.length - 1; i >= 0; i--)
        content = [wrap[i].create(content)];
    let doc = schema.doc(content);
    let changes = ChangeSet.create(doc, { from: wrap.length + 1, to: doc.length - wrap.length - 1, insert: slice, fit: context });
    doc = changes.apply(doc);
    let node = doc.length > wrap.length && doc.plotAt(wrap.length);
    return node && node.type == parent.type ? node : null;
}
function isTableContent(schema, type) {
    return type == TableRow.type || schema.matchNode(type, Node.Group.TableCell);
}
function pastedCells(schema, slice, context) {
    let table = null, tok;
    if (slice.content.length == 1 && (tok = slice.content[0]).tokenType == Token.Type.Node &&
        tok.type == Table.type) {
        table = tok;
    }
    else if (context.length && isTableContent(schema, context[0].type) ||
        slice.content.some(tok => tok.tokenType != Token.Type.Close && isTableContent(schema, tok.type))) {
        table = fitSlice(schema, Table, slice, context);
    }
    return table && ensureRectangular(schema, table.content.map(row => row.content));
}
function ensureRectangular(schema, rows) {
    let widths = [];
    for (let i = 0; i < rows.length; i++) {
        for (let cell of rows[i]) {
            let rowSpan = cell.mark(RowSpan) ?? 1, colSpan = cell.mark(ColSpan) ?? 1;
            for (let r = i; r < i + rowSpan; r++)
                widths[r] = (widths[r] || 0) + colSpan;
        }
    }
    let width = widths.reduce((a, b) => Math.max(a, b));
    for (let r = 0; r < widths.length; r++) {
        if (r >= rows.length)
            rows[r] = [];
        for (let i = widths[r]; i < width; i++)
            rows[r] = rows[r].concat(schema.createAndFill(cellTag(schema)));
    }
    return { height: rows.length, width, rows };
}
function clipCells({ width, height, rows }, newWidth, newHeight) {
    if (width != newWidth) {
        let added = new Map();
        rows = rows.map((row, i) => {
            let cells = [], size = added.get(i) ?? 0, j = 0;
            while (size < newWidth) {
                let nextCell = row[(j++) % row.length];
                let rowSpan = nextCell.mark(RowSpan) ?? 1, colSpan = nextCell.mark(ColSpan) ?? 1;
                if (size + colSpan > newWidth) {
                    colSpan = newWidth - size;
                    nextCell = nextCell.withMarks(colSpan == 1 ? ColSpan.removeFromSet(nextCell.marks)
                        : ColSpan.of(colSpan).addToSet(nextCell.marks));
                }
                for (let k = 1; k < rowSpan; k++)
                    added.set(i + k, (added.get(i + k) ?? 0) + colSpan);
                size += colSpan;
                cells.push(nextCell);
            }
            return cells;
        });
    }
    if (height != newHeight) {
        let newRows = [];
        for (let i = 0; i < newHeight; i++) {
            let nextRow = rows[i % rows.length], space = newHeight - i;
            newRows.push(nextRow.map(cell => {
                let rowSpan = cell.mark(RowSpan) ?? 1;
                return rowSpan <= space ? cell :
                    cell.withMarks(space == 1 ? RowSpan.removeFromSet(cell.marks) : RowSpan.of(space).addToSet(cell.marks));
            }));
        }
        rows = newRows;
    }
    return { height: newHeight, width: newWidth, rows };
}
function growTableHorizontally(schema, map, width) {
    let changes = [];
    if (width > map.width) {
        for (let row = 0; row < map.height; row++) {
            let lastCell = map.table.content[row].lastChild;
            let fillCell = schema.createAndFill((lastCell || cellTag(schema)).type.default), cells = [];
            for (let i = map.width; i < width; i++)
                cells.push(fillCell);
            changes.push({ from: map.cellInsertionPos(map.width, row), insert: cells });
        }
    }
    return changes;
}
function growTableVertically(schema, map, height) {
    let changes = [];
    if (height > map.height) {
        let cells = [];
        for (let i = 0; i < map.width; i++)
            cells.push(schema.createAndFill(cellTag(schema)));
        let row = TableRow.create(cells), rows = [];
        for (let i = map.height; i < height; i++)
            rows.push(row);
        changes.push({ from: map.rowPos(map.height), insert: rows });
    }
    return changes;
}
function isolateVertically(schema, map, startCol, endCol, row) {
    let changes = [];
    if (row == 0 || row == map.height)
        return changes;
    for (let col = startCol; col < endCol;) {
        let pos = map.cellAt(col, row);
        if (pos != null && map.cellAt(col, row - 1) == pos) {
            let node = map.getCell(pos), rect = map.cellRect(pos);
            let topRows = row - rect.startRow, botRows = rect.endRow - row;
            changes.push(topRows == 1 ? { from: pos, remove: RowSpan.isInSet(node.marks) } : { from: pos, add: RowSpan.of(topRows) });
            let split = node.tag.withMarks(botRows == 1 ? RowSpan.removeFromSet(node.marks) : RowSpan.of(botRows).addToSet(node.marks));
            changes.push({ from: map.cellInsertionPos(rect.startCol, row), insert: [schema.createAndFill(split)] });
            col = rect.endCol;
        }
        else {
            col++;
        }
    }
    return changes;
}
function isolateHorizontally(schema, map, startRow, endRow, col) {
    let changes = [];
    if (col == 0 || col == map.width)
        return changes;
    for (let row = startRow; row < endRow;) {
        let pos = map.cellAt(col, row);
        if (pos != null && map.cellAt(col - 1, row) == pos) {
            let node = map.getCell(pos), rect = map.cellRect(pos);
            let topCols = col - rect.startCol, botCols = rect.endCol - col;
            changes.push(topCols == 1 ? { from: pos, remove: ColSpan.isInSet(node.marks) } : { from: pos, add: ColSpan.of(topCols) });
            let split = node.tag.withMarks(botCols == 1 ? ColSpan.removeFromSet(node.marks) : ColSpan.of(botCols).addToSet(node.marks));
            changes.push({ from: map.cellInsertionPos(col, row), insert: [schema.createAndFill(split)] });
            row = rect.endRow;
        }
        else {
            row++;
        }
    }
    return changes;
}
function insertCells(state, map, startCol, startRow, cells, event) {
    let { schema } = state.doc;
    let endCol = startCol + cells.width, endRow = startRow + cells.height;
    let doc = state.doc, changeSet = null, changes = [];
    function flush() {
        if (changes.length) {
            let newSet = ChangeSet.create(doc, changes);
            doc = newSet.apply(doc);
            changeSet = changeSet ? changeSet.compose(newSet) : newSet;
            let table = doc.resolvePlot(map.tablePos);
            map = TableMap.get(table.node, table.start);
            changes = [];
        }
    }
    if (map.width < endCol)
        changes = growTableHorizontally(schema, map, endCol);
    else if (endCol < map.width)
        changes = isolateHorizontally(schema, map, startRow, endRow, endCol);
    flush();
    if (startCol)
        changes = isolateHorizontally(schema, map, startRow, endRow, startCol);
    flush();
    if (map.height < endRow)
        changes = growTableVertically(schema, map, endRow);
    else if (endRow < map.height)
        changes = isolateVertically(schema, map, startCol, endCol, endRow);
    flush();
    if (startRow)
        changes = isolateVertically(schema, map, startCol, endCol, startRow);
    flush();
    for (let i = 0; i < cells.height; i++) {
        let content = cells.rows[i], row = startRow + i;
        changes.push({ from: map.cellInsertionPos(startCol, row), to: map.cellInsertionPos(endCol, row), insert: content });
    }
    flush();
    let startCell = map.cellAt(startCol, startRow);
    let endCell = map.cellAt(endCol - 1, endRow - 1);
    let selection = startCell == null || endCell == null ? undefined
        : CellSelection.between(doc, startCell, endCell + map.getCell(endCell).length);
    return {
        changes: changeSet,
        selection,
        userEvent: `${event}.paste`
    };
}
function handleTablePaste(state, slice, context, drop) {
    let { schema } = state.doc;
    if (drop == null && state.selection instanceof CellSelection) {
        let cells = pastedCells(schema, slice, context);
        if (!cells) {
            let single = fitSlice(schema, cellTag(schema), slice, context);
            if (!single)
                return false;
            cells = { width: 1, height: 1, rows: [[single]] };
        }
        let table = state.sel.from.parent.parent, map = TableMap.get(table.node, table.start);
        let rect = map.rectBetween(state.selection.anchorCell, state.selection.headCell);
        return insertCells(state, map, rect.startCol, rect.startRow, clipCells(cells, rect.endCol - rect.startCol, rect.endRow - rect.startRow), "paste");
    }
    else {
        let cx = tableContext(state, drop), cells;
        if (!cx || !(cells = pastedCells(schema, slice, context)))
            return false;
        let rect = cx.map.cellRect(cx.cells[0]);
        return insertCells(state, cx.map, rect.startCol, rect.startRow, cells, drop == null ? "drop" : "paste");
    }
}
const tablePasteHandler = /*@__PURE__*/Wordgard.pasteHandler.of((wg, _event, slice, context) => {
    let tr = handleTablePaste(wg.state, slice, context);
    return tr && (wg.dispatch(tr), true);
});
const tableDropHandler = /*@__PURE__*/Wordgard.dropHandler.of((wg, _event, pos, move, slice, context) => {
    let tr = handleTablePaste(wg.state, slice, context, pos);
    if (!tr)
        return false;
    if (move) {
        let clear = [];
        wg.state.doc.iterate(move.from, move.to, (node, pos) => {
            if (wg.state.schema.matchNode(node.type, Node.Group.TableCell))
                clear.push({ from: pos + 1, to: pos + node.length - 1, fit: true });
        });
        let tr2 = wg.state.update(Transaction.merge(wg.state, tr, { changes: clear }));
        wg.dispatch(tr2);
    }
    else {
        wg.dispatch(tr);
    }
    return true;
});

const SVG = "http://www.w3.org/2000/svg";
class DimensionPicker {
    wg;
    finish;
    dom;
    svg;
    announce;
    width = 2;
    height = 2;
    gridWidth = 6;
    gridHeight = 4;
    ltr;
    constructor(wg, finish) {
        this.wg = wg;
        this.finish = finish;
        this.dom = document.createElement("div");
        this.dom.className = "wg-dimension-picker";
        this.announce = this.dom.appendChild(document.createElement("div"));
        this.announce.className = "wg-dimension-announce";
        this.announce.setAttribute("aria-live", "polite");
        this.svg = this.dom.appendChild(document.createElementNS(SVG, "svg"));
        this.svg.setAttribute("aria-hidden", "true");
        this.ltr = wg.state.textLTR;
        this.render();
        this.dom.addEventListener("mousemove", e => {
            let rect = this.svg.getBoundingClientRect();
            let xOff = this.ltr ? e.clientX - 4 - rect.left : rect.right - 4 - e.clientX;
            let yOff = e.clientY - 4 - rect.top;
            let x = Math.max(0, Math.floor(xOff / 19)), y = Math.max(0, Math.floor(yOff / 19));
            this.setSize(x + 1, y + 1);
        });
        this.dom.addEventListener("mousedown", e => {
            if (e.button == 0) {
                e.preventDefault();
                this.finish(this.width, this.height);
            }
        });
        this.dom.addEventListener("keydown", e => {
            if (e.key == (this.ltr ? "ArrowLeft" : "ArrowRight") && this.width > 1) {
                this.setSize(this.width - 1, this.height);
            }
            else if (e.key == (this.ltr ? "ArrowRight" : "ArrowLeft") && this.width < 15) {
                this.setSize(this.width + 1, this.height);
            }
            else if (e.key == "ArrowUp" && this.height > 1) {
                this.setSize(this.width, this.height - 1);
            }
            else if (e.key == "ArrowDown" && this.height < 15) {
                this.setSize(this.width, this.height + 1);
            }
            else if (e.key == " " || e.key == "Enter") {
                this.finish(this.width, this.height);
            }
            else {
                return;
            }
            e.preventDefault();
        });
    }
    render() {
        this.dom.setAttribute("aria-label", tablePhrases.get(this.wg.state, "dimensions_title", this.width, this.height));
        this.announce.textContent = tablePhrases.get(this.wg.state, "dimensions_live", this.width, this.height);
        this.svg.textContent = "";
        let width = this.gridWidth * 19 + 4;
        this.svg.setAttribute("width", String(width));
        this.svg.setAttribute("height", String(this.gridHeight * 19 + 4));
        for (let y = 0; y < this.gridHeight; y++)
            for (let x = 0; x < this.gridWidth; x++) {
                let rect = this.svg.appendChild(document.createElementNS(SVG, "rect"));
                rect.setAttribute("width", String(15));
                rect.setAttribute("height", String(15));
                rect.setAttribute("x", String(this.ltr ? x * 19 + 4 : width - (x + 1) * 19));
                rect.setAttribute("y", String(y * 19 + 4));
                rect.setAttribute("class", "wg-dimension-cell" + (x < this.width && y < this.height ? " wg-dimension-cell-active" : ""));
            }
    }
    setSize(width, height) {
        if (width == this.width && height == this.height)
            return;
        this.width = Math.min(15, width);
        this.height = Math.min(15, height);
        if (this.gridWidth <= this.width)
            this.gridWidth = Math.min(15, this.width + 1);
        if (this.gridHeight <= this.height)
            this.gridHeight = Math.min(15, this.height + 1);
        this.render();
    }
}
function insertTable(wg, width, height) {
    let { state } = wg, { schema } = state.doc, cell = cellTag(schema);
    if (!cell)
        return;
    let cellNode = schema.createAndFill(cell), cells = [];
    for (let i = 0; i < width; i++)
        cells.push(cellNode);
    let row = TableRow.create(cells), rows = [];
    for (let i = 0; i < height; i++)
        rows.push(row);
    let table = Table.create(rows), { from, to } = state.selection.replacementRange;
    let changes = ChangeSet.create(state.doc, { from, to, insert: [table], fit: true });
    let tablePos = changes.findInserted(tag => tag.type == Table.type);
    wg.dispatch({
        changes,
        selection: cx => GardSelection.near(cx, tablePos == null ? from : tablePos + 3, 1),
        userEvent: "insert.table"
    });
}
const dimensionPicker = /*@__PURE__*/Menu.CustomControl.define({
    render(wg, done) {
        return new DimensionPicker(wg, (width, height) => {
            done();
            insertTable(wg, width, height);
            wg.focus();
        });
    }
});
function tableMenu() {
    return [
        tableMenu.createTable,
        tableMenu.modifyTable,
        tableMenu.toggleHeader,
        tableMenu.addRowAbove, tableMenu.addRowBelow, tableMenu.deleteRow,
        tableMenu.addColumnBefore, tableMenu.addColumnAfter, tableMenu.deleteColumn,
        tableMenu.mergeCells, tableMenu.splitCell
    ];
}
const tableIcon = {
    icon: "M0 23a23 13 0 0 1 13-13h74a13 13 0 0 1 13 13v54a 13 13 0 0 1 -13 13h-74a13 13 0 0 1 -13 -13v-54M7 31v14h25v-14h-25M37 31v14h26v-14h-26M68 31v14h25v-14h-26M7 50v14h25v-14h-25M37 50v14h26v-14h-26M68 50v14h25v-14h-26M7 69v8a6 6 0 0 0 6 6h19v-14h-25M37 69v14h26v-14h-26M68 69v14h19a6 6 0 0 0 6 -6v-8h-26"
};
;tableMenu = /*@__PURE__*/(function (tableMenu) {
    tableMenu.createTable = Menu.Submenu.define({
        select(state) {
            return state.schema.has(Table) && !state.sel.head.matchingParent(plot => plot.type == Table.type);
        },
        label: tableIcon,
        description: tablePhrases.ref("insert_table"),
        parent: Menu.Group.insert,
        rank: 70,
        content: [dimensionPicker]
    });
    tableMenu.modifyTable = Menu.Submenu.define({
        select(state) {
            return !!state.sel.head.matchingParent(plot => plot.type == Table.type);
        },
        label: tableIcon,
        description: tablePhrases.ref("modify_table"),
        parent: Menu.Group.block,
        rank: 90
    });
    tableMenu.toggleHeader = Menu.Button.define({
        run: toggleHeaderCell,
        select: state => !!headerCellTag(state.schema),
        label: tablePhrases.ref("toggle_header"),
        parent: tableMenu.modifyTable,
        rank: 10
    });
    tableMenu.addRowAbove = Menu.Button.define({
        run: wg => Command.dispatch(wg, addRow, "before"),
        label: tablePhrases.ref("add_row_above"),
        parent: tableMenu.modifyTable,
        rank: 20,
    });
    tableMenu.addRowBelow = Menu.Button.define({
        run: wg => Command.dispatch(wg, addRow, "after"),
        label: tablePhrases.ref("add_row_below"),
        parent: tableMenu.modifyTable,
        rank: 21,
    });
    tableMenu.deleteRow = Menu.Button.define({
        run: deleteRow,
        label: tablePhrases.ref("delete_row"),
        parent: tableMenu.modifyTable,
        rank: 25
    });
    tableMenu.addColumnBefore = Menu.Button.define({
        run: wg => Command.dispatch(wg, addColumn, "before"),
        label: tablePhrases.ref("add_col_before"),
        parent: tableMenu.modifyTable,
        rank: 30,
    });
    tableMenu.addColumnAfter = Menu.Button.define({
        run: wg => Command.dispatch(wg, addColumn, "after"),
        label: tablePhrases.ref("add_col_after"),
        parent: tableMenu.modifyTable,
        rank: 31,
    });
    tableMenu.deleteColumn = Menu.Button.define({
        run: deleteColumn,
        label: tablePhrases.ref("delete_col"),
        parent: tableMenu.modifyTable,
        rank: 35,
    });
    tableMenu.mergeCells = Menu.Button.define({
        run: mergeCells,
        select: state => {
            let { selection } = state;
            return selection instanceof CellSelection && selection.ranges.length > 1 &&
                state.schema.has(ColSpan) && state.schema.has(RowSpan);
        },
        label: tablePhrases.ref("merge_cells"),
        parent: tableMenu.modifyTable,
        rank: 40,
    });
    tableMenu.splitCell = Menu.Button.define({
        run: splitCell,
        select: state => {
            let { selection } = state;
            if (!(selection instanceof CellSelection) || selection.ranges.length != 1)
                return false;
            let cell = state.sel.from.nodeAfter;
            return !!(cell && (cell.mark(ColSpan) || cell.mark(RowSpan)));
        },
        label: tablePhrases.ref("split_cell"),
        parent: tableMenu.modifyTable,
        rank: 41,
    });
;return tableMenu})(tableMenu);

const tableTheme = /*@__PURE__*/Wordgard.styles({
    table: {
        borderCollapse: "collapse",
        tableLayout: "fixed",
        width: "100%",
        overflow: "hidden"
    },
    "td, th": {
        verticalAlign: "top",
        border: "1px solid var(--wg-border-color)",
        padding: "3px 6px",
        textAlign: "left"
    },
    ".wg-selected-cell": {
        background: "#ddf",
        "&::selection, & ::selection": { backgroundColor: "transparent" },
        "& :focus ::selection, & :focus::selection": { backgroundColor: "Highlight" }
    },
    ".wg-dimension-announce": {
        position: "absolute",
        width: "0px",
        overflow: "hidden"
    },
    ".wg-dimension-cell": {
        fill: "none",
        stroke: "#ccc",
        strokeWidth: "1.5px",
        rx: "2px"
    },
    ".wg-dimension-cell-active": {
        stroke: "var(--wg-highlight-color)"
    }
});
function tables(config = {}) {
    let result = [
        GardState.schemaElement.of(Table), GardState.schemaElement.of(TableRow),
        tableTheme,
        CellSelection,
        tableCorrection,
        tablePasteHandler,
        tableDropHandler,
        tableMenu()
    ];
    if (config.cellContent == "block") {
        result.push(GardState.schemaElement.of(BlockCell));
        if (config.headerCells != false)
            result.push(GardState.schemaElement.of(BlockHeaderCell));
    }
    else {
        result.push(GardState.schemaElement.of(Cell));
        if (config.headerCells != false)
            result.push(GardState.schemaElement.of(HeaderCell));
    }
    if (config.cellSpanning != false)
        result.push(GardState.schemaElement.of(RowSpan), GardState.schemaElement.of(ColSpan));
    return result;
}
;tables = /*@__PURE__*/(function (tables) {
    tables.correction = tableCorrection;
    tables.pasteHandler = tablePasteHandler;
    tables.dropHandler = tableDropHandler;
;return tables})(tables);

export { CellSelection, addColumn, addRow, deleteColumn, deleteRow, handleTablePaste, mergeCells, splitCell, tableMenu, tables, toggleHeaderCell };
