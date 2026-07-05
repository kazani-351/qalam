import { GardState } from 'wordgard/state';

const phraseOverride = /*@__PURE__*/GardState.Facet.define({
    combine(records) {
        let map = new Map();
        for (let i = records.length - 1; i >= 0; i--) {
            let { set, phrases } = records[i];
            let known = map.get(set);
            map.set(set, known ? { ...known, ...phrases } : phrases);
        }
        return map;
    }
});
class PhraseSet {
    phrases;
    constructor(phrases) {
        this.phrases = phrases;
    }
    get(state, tag, ...insert) {
        let override = state.facet(phraseOverride).get(this);
        let phrase = (override && override[tag]) ?? this.phrases[tag];
        if (insert.length)
            phrase = phrase.replace(/\$(\$|\d*)/g, (m, i) => {
                if (i == "$")
                    return "$";
                let n = +(i || 1);
                return !n || n > insert.length ? m : insert[n - 1];
            });
        return phrase;
    }
    ref(tag) {
        return (state, ...insert) => this.get(state, tag, ...insert);
    }
    translate(phrases) {
        return phraseOverride.of({ set: this, phrases });
    }
    translatePartial(phrases) {
        return phraseOverride.of({ set: this, phrases: phrases });
    }
    static define(phrases) {
        return new PhraseSet(phrases);
    }
    static didChange(a, b) {
        return a.facet(phraseOverride) != b.facet(phraseOverride);
    }
}

const phrases = /*@__PURE__*/PhraseSet.define({
    dialog_close: "close",
    overflow_more: "More",
    block_style: "Block style",
    toggle_strong: "Toggle strong emphasis",
    toggle_em: "Toggle emphasis",
    toggle_code: "Toggle code font",
    toggle_underline: "Toggle underline",
    toggle_strikethrough: "Toggle strikethrough",
    toggle_super: "Toggle superscript",
    toggle_sub: "Toggle subscript",
    link_target: "Link target",
    create_link: "Create link",
    text_color: "Text color",
    background_color: "Background color",
    undo: "Undo",
    redo: "Redo",
    paragraph: "Paragraph",
    code_block: "Code block",
    heading_1: "Heading 1",
    heading_2: "Heading 2",
    heading_3: "Heading 3",
    toggle_bullet_list: "Toggle bullet list",
    toggle_ordered_list: "Toggle ordered list",
    toggle_quote: "Toggle blockquote",
    alignment: "Alignment",
    align_start: "Align text to block start",
    align_end: "Align text to block end",
    align_center: "Center text",
    text_dir: "Text direction",
    text_dir_ltr: "Left-to-right text",
    text_dir_rtl: "Right-to-left text",
    text_dir_auto: "Automatic text direction",
});
const imagePhrases = /*@__PURE__*/PhraseSet.define({
    insert_image: "Insert image",
    update_image: "Update image",
    update: "Update",
    insert: "Insert",
    cancel: "Cancel",
    inline: "Inline",
    figure: "Figure",
    figure_center: "Centered figure",
    figure_end: "Figure aligned to end",
    captioned: "Captioned",
    image_style: "Image style",
    uploading: "Uploading...",
    upload_failed: "Image upload failed",
    width: "Width in pixels",
    upload_image: "Upload an image",
    image_source: "Image source",
    alt_text: "Alternative text",
    describe_image: "Describe the image",
    auto: "automatic"
});
const colorNames = /*@__PURE__*/PhraseSet.define({
    none: "none",
    black: "black",
    white: "white",
    grey: "grey",
    red_berry: "red berry",
    red: "red",
    orange: "orange",
    yellow: "yellow",
    green: "green",
    cyan: "cyan",
    cornflower: "cornflower",
    blue: "blue",
    purple: "purple",
    magenta: "magenta",
    dark: "dark",
    darker: "darker",
    darkest: "very dark",
    light: "light",
    lighter: "lighter",
    lightest: "very light",
});
const tablePhrases = /*@__PURE__*/PhraseSet.define({
    dimensions_title: "Table dimensions $1 by $2. Use arrow keys to change.",
    dimensions_live: "$1 by $2",
    insert_table: "Insert a table",
    modify_table: "Modify table",
    toggle_header: "Toggle header cells",
    add_row_above: "Add row above",
    add_row_below: "Add row below",
    delete_row: "Delete row",
    add_col_before: "Add column before",
    add_col_after: "Add column before",
    delete_col: "Delete column",
    merge_cells: "Merge cells",
    split_cell: "Split cell"
});

export { PhraseSet, colorNames, imagePhrases, phrases, tablePhrases };
