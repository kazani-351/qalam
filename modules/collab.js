import { GardState, Transaction } from 'wordgard/state';
import { ChangeSet } from 'wordgard/doc';

class LocalUpdate {
    changes;
    effects;
    constructor(changes, effects) {
        this.changes = changes;
        this.effects = effects;
    }
}
class CollabState {
    version;
    syncedDoc;
    unconfirmed;
    constructor(
    version, 
    syncedDoc, 
    unconfirmed) {
        this.version = version;
        this.syncedDoc = syncedDoc;
        this.unconfirmed = unconfirmed;
    }
}
const collabConfig = /*@__PURE__*/GardState.Facet.define({
    combine(configs) {
        let combined = GardState.Facet.combineConfig(configs, { startVersion: 0, clientID: null, sharedEffects: () => [] }, {
            generatedID: a => a
        });
        if (combined.clientID == null)
            combined.clientID = (configs.length && configs[0].generatedID) || "";
        return combined;
    }
});
const collabReceive = /*@__PURE__*/Transaction.Effect.define({
    map(state, changes) {
        return changes.empty ? state
            : new CollabState(state.version, state.syncedDoc, state.unconfirmed.concat(new LocalUpdate(changes, [])));
    }
});
const collabField = /*@__PURE__*/GardState.Field.define({
    create(state) {
        return new CollabState(state.facet(collabConfig).startVersion, state.doc, []);
    },
    update(collab, tr) {
        for (let e of tr.effects)
            if (e.is(collabReceive))
                return e.value;
        let { sharedEffects } = tr.startState.facet(collabConfig);
        let effects = sharedEffects(tr);
        if (effects.length || !tr.changes.empty)
            return new CollabState(collab.version, collab.syncedDoc, collab.unconfirmed.concat(new LocalUpdate(tr.changes, effects)));
        return collab;
    }
});
function collab(config = {}) {
    return [collabField, collabConfig.of({ generatedID: Math.floor(Math.random() * 1e9).toString(36), ...config })];
}
function collapseUpdates(updates) {
    let { changes, effects = [] } = updates[0];
    for (let i = 1; i < updates.length; i++) {
        let next = updates[i];
        effects = Transaction.Effect.mapEffects(effects, next.changes);
        if (next.effects)
            effects = effects.concat(next.effects);
        changes = changes.compose(next.changes);
    }
    return { changes, effects };
}
;collab = /*@__PURE__*/(function (collab) {
    function receive(state, updates) {
        let { version, syncedDoc, unconfirmed } = state.field(collabField);
        let { clientID } = state.facet(collabConfig);
        for (let { versionBefore, versionAfter } of updates) {
            if (versionBefore != version)
                throw new Error("Version mismatchin in received collab update");
            version = versionAfter;
        }
        if (updates.length && updates[0].clientID == clientID) {
            let ours = updates[0], size = ours.versionAfter - ours.versionBefore;
            unconfirmed = unconfirmed.slice(size);
            updates = updates.slice(1);
            syncedDoc = unconfirmed.length ? ours.changes.apply(syncedDoc) : state.doc;
        }
        if (!updates.length)
            return state.update({
                annotations: Transaction.remote.of(true),
                effects: collabReceive.of(new CollabState(version, syncedDoc, unconfirmed))
            });
        let { changes, effects } = collapseUpdates(updates);
        let newSyncedDoc = changes.apply(syncedDoc);
        if (unconfirmed.length) {
            let ours = collapseUpdates(unconfirmed);
            let { a, b } = ChangeSet.transform(syncedDoc, changes, ours.changes);
            let oursMapped = new LocalUpdate(b, Transaction.Effect.mapEffects(ours.effects, a));
            unconfirmed = [oursMapped];
            changes = a;
            effects = Transaction.Effect.mapEffects(effects, oursMapped.changes);
        }
        syncedDoc = newSyncedDoc;
        return state.update({
            changes,
            effects: effects.concat(collabReceive.of(new CollabState(version, syncedDoc, unconfirmed))),
            annotations: [Transaction.addToHistory.of(false), Transaction.remote.of(true)],
        });
    }
    collab.receive = receive;
    function sendableUpdate(state) {
        let { unconfirmed, version } = state.field(collabField);
        if (!unconfirmed.length)
            return null;
        let { changes, effects } = collapseUpdates(unconfirmed);
        return {
            versionBefore: version,
            versionAfter: version + unconfirmed.length,
            changes, effects,
            clientID: state.facet(collabConfig).clientID
        };
    }
    collab.sendableUpdate = sendableUpdate;
    function getSyncedVersion(state) {
        return state.field(collabField).version;
    }
    collab.getSyncedVersion = getSyncedVersion;
    function getClientID(state) {
        return state.facet(collabConfig).clientID;
    }
    collab.getClientID = getClientID;
;return collab})(collab);

export { collab };
