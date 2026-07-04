import { Node, Plot, Elt, ValidationError, Mark, Leaf, parse } from 'wordgard/doc';

const G = /*@__PURE__*/(() => Node.Group)();
const Paragraph = /*@__PURE__*/(() => Plot.define("Paragraph", {
    inlineContent: true,
    group: G.Content,
    defaultBlock: true,
    shape: { element: "p" }
}))();
const Heading = /*@__PURE__*/(() => Plot.Type.define("Heading", {
    defaultParam: 1,
    validate: value => {
        if (typeof value != "number" || Math.floor(value) != value || value < 1 || value > 6)
            throw new ValidationError(`Invalid heading level: ${value}`);
    },
    inlineContent: true,
    group: G.Content,
    shape: { structure: level => Elt.mk("h" + level, [0]), atom: false },
    defining: true,
    parseRules: [
        { selector: "h1", param: 1 },
        { selector: "h2", param: 2 },
        { selector: "h3", param: 3 },
        { selector: "h4", param: 4 },
        { selector: "h5", param: 5 },
        { selector: "h6", param: 6 },
    ]
}))();
const CodeBlock = /*@__PURE__*/(() => Plot.define("CodeBlock", {
    inlineContent: true,
    group: G.Content,
    role: Node.Role.Code,
    shape: { element: "pre" },
}))();
const CodeBlockLanguage = /*@__PURE__*/Mark.Type.define("CodeBlockLanguage", {
    target: CodeBlock,
    validate: "string",
    shape: { attribute: "data-language", value: 0 }
});
const Blockquote = /*@__PURE__*/(() => Plot.define("Blockquote", {
    blockContent: G.Content,
    group: G.Content,
    shape: { element: "blockquote" },
    autoJoin: true
}))();
const ListItem = /*@__PURE__*/(() => Plot.define("ListItem", {
    blockContent: G.Content,
    shape: { element: "li" },
    defining: true,
}))();
const InlineListItem = /*@__PURE__*/Plot.define("ListItem", {
    inlineContent: true,
    shape: { element: "li" },
    defining: true,
});
const OrderedList = /*@__PURE__*/(() => Plot.Type.define("OrderedList", {
    defaultParam: 1,
    validate: "number",
    blockContent: [ListItem, InlineListItem],
    group: G.Content,
    role: Node.Role.List,
    defining: true,
    shape: {
        element: "ol",
        attributes: start => start == 1 ? {} : { start: String(start) },
        readElement: elt => Number(elt.getAttribute("start") || "1")
    },
    autoJoin: (_a, b) => b.param == 1
}))();
const BulletList = /*@__PURE__*/(() => Plot.define("BulletList", {
    blockContent: [ListItem, InlineListItem],
    group: G.Content,
    role: Node.Role.List,
    defining: true,
    shape: { element: "ul" },
    autoJoin: true
}))();
const HorizontalRule = /*@__PURE__*/(() => Leaf.define("HorizontalRule", {
    group: G.Content,
    shape: { element: "hr" },
    toText: () => "---",
    selectable: true
}))();
const LineBreak = /*@__PURE__*/(() => Leaf.define("LineBreak", {
    inline: true,
    role: Node.Role.LineBreak,
    toText: () => "\n",
    shape: { element: "br" }
}))();
const Cell = /*@__PURE__*/(() => Plot.define("Cell", {
    inlineContent: true,
    group: G.TableCell,
    isolating: true,
    cursorBarrier: false,
    shape: { element: "td" }
}))();
const HeaderCell = /*@__PURE__*/(() => Plot.define("HeaderCell", {
    inlineContent: true,
    group: G.TableCell,
    isolating: true,
    cursorBarrier: false,
    shape: { element: "th" }
}))();
const BlockCell = /*@__PURE__*/(() => Plot.define("Cell", {
    blockContent: G.Content,
    group: G.TableCell,
    isolating: true,
    cursorBarrier: false,
    shape: { element: "td" }
}))();
const BlockHeaderCell = /*@__PURE__*/(() => Plot.define("HeaderCell", {
    blockContent: G.Content,
    group: G.TableCell,
    isolating: true,
    cursorBarrier: false,
    shape: { element: "th" }
}))();
const TableRow = /*@__PURE__*/(() => Plot.define("TableRow", {
    blockContent: G.TableCell,
    canBeEmpty: true,
    orientation: "row",
    shape: { element: "tr" }
}))();
const Table = /*@__PURE__*/(() => Plot.define("Table", {
    blockContent: TableRow,
    isolating: true,
    group: G.Content,
    shape: { structure: Elt.mk("table", [Elt.mk("tbody", [0])]) },
    parseRules: [{ selector: "table" }]
}))();
function validatePosInt(value) {
    if (typeof value != "number" || Math.round(value) != value || value < 1)
        throw new RangeError(`${value} is not a positive integer`);
}
function readPosInt(value) {
    let num = Number.parseInt(value);
    if (Number.isNaN(num) || num < 1)
        return parse.Reject;
    return num;
}
const ColSpan = /*@__PURE__*/(() => Mark.Type.define("ColSpan", {
    target: G.TableCell,
    validate: validatePosInt,
    shape: { attribute: "colspan", value: span => String(span), readAttribute: readPosInt }
}))();
const RowSpan = /*@__PURE__*/(() => Mark.Type.define("RowSpan", {
    target: G.TableCell,
    validate: validatePosInt,
    shape: { attribute: "rowspan", value: span => String(span), readAttribute: readPosInt }
}))();
const Image = /*@__PURE__*/Leaf.Type.define("Image", {
    inline: true,
    validate: "string",
    shape: { element: "img", attributes: src => ({ src }) },
    selectable: true,
    parseRules: [{
            selector: "img[src]",
            readElement: elt => elt.src
        }]
});
const Figure = /*@__PURE__*/(() => Leaf.Type.define("Figure", {
    validate: "string",
    shape: { structure: src => Elt.mk("figure", [Elt.mk("img", { src })]) },
    selectable: true,
    group: G.Content,
    parseRules: [{
            selector: "figure:has(img[src])",
            marksFrom: "img[src]",
            readElement: elt => elt.querySelector("img[src]").src,
            precedence: 2
        }]
}))();
const CaptionedFigure = /*@__PURE__*/(() => Plot.Type.define("CaptionedFigure", {
    inlineContent: true,
    validate: "string",
    shape: { structure: src => Elt.mk("figure", [Elt.mk("img", { src }), Elt.mk("figcaption", [0])]), atom: false },
    group: G.Content,
    parseRules: [{
            selector: "figure:has(img[src]):has(figcaption)",
            marksFrom: "img[src]",
            readElement: elt => elt.querySelector("img[src]").src,
            contentElement: "figcaption",
            precedence: 4
        }]
}))();
const ImageAlt = /*@__PURE__*/Mark.Type.define("ImageAlt", {
    target: [Image, Figure, CaptionedFigure],
    validate: "string",
    shape: { attribute: "alt", value: 0, preferTarget: "img" }
});
const ImageSize = /*@__PURE__*/Mark.Type.define("ImageSize", {
    target: [Image, Figure, CaptionedFigure],
    validate: "number",
    shape: { attribute: "style", value: size => `width: ${size}px`, preferTarget: "img" }
});
const Alignment = /*@__PURE__*/(() => Mark.Type.define("Alignment", {
    target: [G.Textblock, Figure],
    keepOnSplit: true,
    keepOnTypeChange: true,
    shape: { attribute: "style", value: align => `text-align: ${align}` },
    parseRules: [
        { attribute: "style/text-align", readAttribute: value => /^(end|center)$/.test(value) ? value : parse.Reject }
    ]
}))();
const Direction = /*@__PURE__*/(() => Mark.Type.define("Direction", {
    target: G.Textblock,
    keepOnSplit: true,
    keepOnTypeChange: true,
    validate: val => {
        if (val != "ltr" && val != "rtl" && val != "auto")
            throw new ValidationError(`Invalid direction value: ${val}`);
    },
    shape: { attribute: "dir", value: 0 }
}))();
const Emphasis = /*@__PURE__*/Mark.define("Emphasis", {
    rank: 50,
    shape: { element: "em" },
    parseRules: [
        { attribute: "style/font-style", value: "italic" },
        { attribute: "style/font-style", value: "normal", clearMark: p => p.name == "Emphasis" }
    ]
});
const Strong = /*@__PURE__*/Mark.define("Strong", {
    rank: 60,
    shape: { element: "strong" },
    parseRules: [
        { attribute: "style/font-weight",
            readAttribute: value => /^(bold(er)?|[5-9]\d{2,})$/.test(value) ? null : parse.Reject },
        { attribute: "style/font-weight",
            readAttribute: value => /^(normal|lighter|[1-4]\d{2})$/.test(value) ? null : parse.Reject,
            clearMark: p => p.name == "Strong" },
    ]
});
const Underline = /*@__PURE__*/Mark.define("Underline", {
    rank: 40,
    shape: { element: "u" },
    parseRules: [
        { attribute: "style/text-decoration", value: "underline" }
    ]
});
const Strikethrough = /*@__PURE__*/Mark.define("Strikethrough", {
    rank: 42,
    shape: { element: "s" },
    parseRules: [
        { attribute: "style/text-decoration", value: "line-through" }
    ]
});
const Superscript = /*@__PURE__*/Mark.define("Superscript", {
    rank: 45,
    shape: { element: "sup" }
});
const Subscript = /*@__PURE__*/Mark.define("Subscript", {
    rank: 47,
    shape: { element: "sub" }
});
const Link = /*@__PURE__*/Mark.Type.define("Link", {
    rank: 20,
    validate: "string",
    inclusive: false,
    shape: {
        element: "a",
        preferTarget: "a[href]",
        attributes: href => ({ href }),
        readElement: dom => dom.href
    },
});
const Code = /*@__PURE__*/Mark.define("Code", {
    rank: 80,
    shape: { element: "code" }
});
const Color = /*@__PURE__*/Mark.Type.define("Color", {
    rank: 30,
    shape: { attribute: "style/color", value: 0 },
    spanning: true,
});
const BackgroundColor = /*@__PURE__*/Mark.Type.define("BackgroundColor", {
    rank: 35,
    shape: { attribute: "style/background-color", value: 0 },
    spanning: true,
});
const Doc = /*@__PURE__*/(() => Plot.defineDoc({
    blockContent: G.Content
}))();
const InlineDoc = /*@__PURE__*/Plot.defineDoc({
    inlineContent: true
});

export { Alignment, BackgroundColor, BlockCell, BlockHeaderCell, Blockquote, BulletList, CaptionedFigure, Cell, Code, CodeBlock, CodeBlockLanguage, ColSpan, Color, Direction, Doc, Emphasis, Figure, HeaderCell, Heading, HorizontalRule, Image, ImageAlt, ImageSize, InlineDoc, InlineListItem, LineBreak, Link, ListItem, OrderedList, Paragraph, RowSpan, Strikethrough, Strong, Subscript, Superscript, Table, TableRow, Underline };
