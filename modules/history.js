import { Transaction, GardState, GardSelection } from 'wordgard/state';
import { ChangeSet } from 'wordgard/doc';
import { Command, undo as undo$1, redo as redo$1, Menu } from 'wordgard/command';
import { phrases } from 'wordgard/phrases';

const fromHistory = /*@__PURE__*/Transaction.Annotation.define();
const historyConfig = /*@__PURE__*/GardState.Facet.define({
    combine(configs) {
        return GardState.Facet.combineConfig(configs, {
            minDepth: 100,
            newGroupDelay: 500,
            joinToEvent: (_t, isAdjacent) => isAdjacent,
        }, {
            minDepth: Math.max,
            newGroupDelay: Math.min,
            joinToEvent: (a, b) => (tr, adj) => a(tr, adj) || b(tr, adj)
        });
    }
});
const historyField_ = /*@__PURE__*/GardState.Field.define({
    create() {
        return new HistoryState(null, null);
    },
    update(state, tr) {
        let config = tr.state.facet(historyConfig);
        let fromHist = tr.annotation(fromHistory);
        if (fromHist) {
            let from = fromHist.side, event = eventFromTransaction(tr);
            let other = from == 0 ? state.undone : state.done;
            if (event)
                other = new Branch(event.changes, event.effects, null, tr.startState.selection, other);
            return new HistoryState(from == 0 ? fromHist.rest : other, from == 0 ? other : fromHist.rest);
        }
        let isolate = tr.annotation(history.isolate);
        if (isolate == true || isolate == "before")
            state = state.isolate();
        if (tr.annotation(Transaction.addToHistory) === false)
            return tr.changes.empty ? state : new HistoryState(state.done && state.done.addMapping(tr.changes, tr.startState.doc), state.undone && state.undone.addMapping(tr.changes, tr.startState.doc), state.prevTime, state.prevUserEvent);
        let event = eventFromTransaction(tr);
        let time = tr.annotation(Transaction.time), userEvent = tr.annotation(Transaction.userEvent);
        if (event)
            state = state.addChanges(event, time, userEvent, config, tr);
        if (isolate == true || isolate == "after")
            state = state.isolate();
        return state.clip(config.minDepth);
    },
    toJSON(value, state) {
        let mkJSON = (value) => {
            let events = [];
            for (let cur = value; cur; cur = cur.next)
                events.push({ changes: cur.changes.toJSON(), selection: cur.startSelection.toJSON(state) });
            return events;
        };
        return {
            done: mkJSON(value.done = value.done && value.done.resolveFully(state.config)),
            undone: mkJSON(value.undone = value.undone && value.undone.resolveFully(state.config))
        };
    },
    fromJSON(json, state) {
        if (!json || !Array.isArray(json.done) || !Array.isArray(json.undone))
            throw new RangeError("Invalid history JSON");
        let buildBranch = (json) => {
            let result = null;
            for (let i = json.length - 1; i >= 0; i--)
                result = new Branch(ChangeSet.fromJSON(state.schema, json[i].changes), none, null, GardSelection.fromJSON(state, json[i].selection), result);
            return result;
        };
        return new HistoryState(buildBranch(json.done), buildBranch(json.undone));
    }
});
function history(config = {}) {
    return [
        historyField_,
        historyConfig.of(config),
        Command.handler(undo$1, undo),
        Command.handler(redo$1, redo),
        undoButton,
        redoButton,
    ];
}
;history = /*@__PURE__*/(function (history) {
    history.field = historyField_;
    history.isolate = Transaction.Annotation.define();
    history.invertedEffects = GardState.Facet.define();
;return history})(history);
const undo = ({ state }) => {
    let historyState = state.field(historyField_, false);
    if (state.readOnly || !historyState)
        return false;
    return historyState.pop(0, state);
};
const redo = ({ state }) => {
    let historyState = state.field(historyField_, false);
    if (state.readOnly || !historyState)
        return false;
    return historyState.pop(1, state);
};
function depth(branch) {
    return branch ? branch.depth : 0;
}
const undoDepth = (state) => depth(state.field(historyField_, false)?.done);
const redoDepth = (state) => depth(state.field(historyField_, false)?.undone);
class Branch {
    changes;
    effects;
    mapped;
    startSelection;
    next;
    depth;
    constructor(
    changes, 
    effects, 
    mapped, 
    startSelection, next) {
        this.changes = changes;
        this.effects = effects;
        this.mapped = mapped;
        this.startSelection = startSelection;
        this.next = next;
        this.depth = depth(next) + 1;
    }
    addChanges(changes, effects) {
        return new Branch(changes.compose(this.changes), conc(Transaction.Effect.mapEffects(effects, this.changes), this.effects), null, this.startSelection, this.next);
    }
    resolve(config) {
        if (!this.mapped)
            return this;
        let { mapped: { change, doc }, next } = this;
        let { a: mappedMapping, b: mappedChanges } = ChangeSet.transform(doc, change, this.changes);
        if (next)
            next = next.addMapping(mappedMapping, next.mapped ? null : this.changes.apply(doc));
        if (mappedChanges.empty && !this.effects.length)
            return next && next.resolve(config);
        let selDoc, selCx = {
            get doc() { return selDoc || (selDoc = mappedChanges.apply(change.apply(doc))); },
            config
        };
        return new Branch(mappedChanges, Transaction.Effect.mapEffects(this.effects, change), null, this.startSelection.map(mappedMapping, selCx), next);
    }
    resolveFully(config) {
        let stack = [];
        for (let head = this; head; head = head.next) {
            head = head.resolve(config);
            if (!head)
                break;
            stack.push(head);
        }
        let result = null;
        for (let i = stack.length - 1; i >= 0; i--) {
            let next = stack[i];
            if (next.next == result)
                result = next;
            else
                result = new Branch(next.changes, next.effects, null, next.startSelection, result);
        }
        return result;
    }
    addMapping(change, startDoc) {
        return new Branch(this.changes, this.effects, this.mapped
            ? { change: this.mapped.change.compose(change), doc: this.mapped.doc }
            : { change, doc: startDoc }, this.startSelection, this.next);
    }
    clip(depth) {
        let stack = [];
        for (let i = 0, cur = this; i < depth && cur; i++, cur = cur.next)
            stack.push(cur);
        let result = null;
        for (let i = stack.length - 1; i >= 0; i--) {
            let event = stack[i];
            result = new Branch(event.changes, event.effects, event.mapped, event.startSelection, result);
        }
        return result;
    }
}
function eventFromTransaction(tr) {
    let effects = none;
    for (let invert of tr.startState.facet(history.invertedEffects)) {
        let result = invert(tr);
        if (result.length)
            effects = effects.concat(result);
    }
    if (!effects.length && tr.changes.empty)
        return null;
    return { changes: tr.changes.invert(tr.startState.doc), effects };
}
function isAdjacent(a, b) {
    let ranges = [], isAdjacent = false;
    a.iterChangedRanges((f, t) => ranges.push(f, t));
    b.iterChangedRanges((_f, _t, f, t) => {
        for (let i = 0; i < ranges.length;) {
            let from = ranges[i++], to = ranges[i++];
            if (t >= from && f <= to)
                isAdjacent = true;
        }
    });
    return isAdjacent;
}
function conc(a, b) {
    return !a.length ? b : !b.length ? a : a.concat(b);
}
const none = [];
const joinableUserEvent = /^(input\.type|delete)($|\.)/;
class HistoryState {
    done;
    undone;
    prevTime;
    prevUserEvent;
    constructor(
    done, 
    undone, 
    prevTime = 0, 
    prevUserEvent = undefined) {
        this.done = done;
        this.undone = undone;
        this.prevTime = prevTime;
        this.prevUserEvent = prevUserEvent;
    }
    isolate() {
        return this.prevTime ? new HistoryState(this.done, this.undone) : this;
    }
    addChanges(event, time, userEvent, config, tr) {
        let done = this.done && this.done.resolve(tr.startState.config);
        if (done && !done.changes.empty &&
            (!userEvent || joinableUserEvent.test(userEvent) || tr.annotation(Transaction.appended)) &&
            ((time - this.prevTime < config.newGroupDelay &&
                config.joinToEvent(tr, isAdjacent(done.changes, event.changes))) ||
                userEvent == "input.type.compose")) {
            done = done.addChanges(event.changes, event.effects);
        }
        else {
            done = new Branch(event.changes, event.effects, null, tr.startState.selection, done);
        }
        return new HistoryState(done, null, time, userEvent);
    }
    pop(side, state) {
        let branch = side == 0 ? this.done : this.undone;
        if (!branch || !(branch = branch.resolve(state.config)))
            return false;
        return {
            changes: branch.changes,
            selection: branch.startSelection,
            effects: branch.effects,
            annotations: fromHistory.of({ side, rest: branch.next }),
            userEvent: side == 0 ? "undo" : "redo",
            scrollIntoView: true
        };
    }
    clip(minDepth) {
        let max = minDepth * 1.3;
        let done = depth(this.done) > max ? this.done.clip(minDepth) : this.done;
        let undone = depth(this.undone) > max ? this.undone.clip(minDepth) : this.undone;
        if (done != this.done || undone != this.undone)
            return new HistoryState(done, undone, this.prevTime, this.prevUserEvent);
        return this;
    }
}
const undoButton = /*@__PURE__*/(() => Menu.Button.define({
    run: undo,
    label: {
        icon: "M69 90c9-16 10-41-24-40v20l-30-30 30-30v19c42-1 46 37 24 61z"
    },
    description: phrases.ref("undo"),
    enable: s => undoDepth(s) > 0,
    parent: Menu.Group.commands,
    rank: 10
}))();
const redoButton = /*@__PURE__*/(() => Menu.Button.define({
    run: redo,
    label: {
        icon: "M55 29v-19l30 30-30 30v-20c-35-1-33 24-24 40-22-24-17-62 24-61z"
    },
    description: phrases.ref("redo"),
    enable: s => redoDepth(s) > 0,
    parent: Menu.Group.commands,
    rank: 20
}))();

export { history, redo, redoButton, redoDepth, undo, undoButton, undoDepth };
