<script lang="ts" module>
  // Hand-written 24×24 stroke icons (praSzczur convention: inline SVG, currentColor, no emoji).
  // New pictogram = one path string here; keep the 1.8 stroke and round joins.
  const PATHS = {
    project: "M4 6h6l2 2h8v11H4zM4 10h16",
    board: "M4 5h16v11H4zM12 16v4M8 20h8M7 9h4M7 12h7",
    note: "M5 4h10l4 4v12H5zM14 4v5h5M8 13h8M8 16h5",
    gear: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8",
    help: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.5",
    keyboard: "M3 7h18v10H3zM7 10h.01M10 10h.01M13 10h.01M16 10h.01M8 14h8",
    snippet: "M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14",
    folder: "M3 6h6l2 2h10v11H3z",
    file: "M6 3h8l4 4v14H6zM14 3v4h4",
    plus: "M12 5v14M5 12h14",
    pin: "M9 4h6l-1 6 3 3H7l3-3zM12 13v7",
    dropper: "M14 5l5 5M16.5 7.5l2-2a2.1 2.1 0 0 0-3-3l-2 2M13 6.5L5 14.5V19h4.5l8-8",
    cursor: "M6 3l12 9-5.5 1.2L15 20l-2.5 1-2.6-6.6L6 18z",
    text: "M6 6h12M12 6v13M9 19h6",
    shape: "M4 13h8v7H4zM16.5 4a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z",
    pen: "M4 20c4-1 6-3 7-6M11 14l8-8-2-2-8 8z",
    camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 10.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    close: "M6 6l12 12M18 6L6 18",
    check: "M5 12l5 5L20 7",
    trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
    edit: "M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4",
    copy: "M9 9h11v11H9zM5 15H4V4h11v1",
    alert: "M12 4l9 16H3L12 4zM12 10v4M12 17v.5",
    info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.5",
    play: "M7 4l13 8-13 8z",
    pause: "M8 5v14M16 5v14",
    refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
    cloud: "M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.5A3.3 3.3 0 0 0 7 18zM12 10v6M9.5 13.5L12 16l2.5-2.5",
    engine: "M13 3L5 14h6l-1 7 8-11h-6z",
    pulse: "M3 12h4l3-7 4 14 3-7h4",
    search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5",
    download: "M12 4v11M7 10l5 5 5-5M5 20h14",
    image: "M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01",
    pdf: "M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 16.5h4",
    moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
    target: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 2v4M12 18v4M2 12h4M18 12h4",
    chevronDown: "M6 9l6 6 6-6",
    chevronRight: "M9 6l6 6-6 6",
    layout: "M3 5h18v14H3zM9 5v14M15 5v14",
    star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
    folderOpen: "M3 6h6l2 2h8v3M3 6v13h15l3-8H7l-4 8",
    folderPlus: "M3 6h6l2 2h10v11H3zM12 11v6M9 14h6",
    filePlus: "M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6",
    collapse: "M7 9l5-5 5 5M7 15l5 5 5-5",
    reveal: "M4 6h6l2 2h8v11H4zM14 13h4M16 11l2 2-2 2",
    link: "M10 14l4-4M8.5 11.5l-2 2a3 3 0 0 0 4.2 4.2l2-2M15.5 12.5l2-2a3 3 0 0 0-4.2-4.2l-2 2",
    unlink: "M8.5 11.5l-2 2a3 3 0 0 0 4.2 4.2l2-2M15.5 12.5l2-2a3 3 0 0 0-4.2-4.2l-2 2M4 4l16 16",
    duplicate: "M8 8h12v12H8zM4 16V4h12M14 11v6M11 14h6",
    tex: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M12 12v6",
    bib: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11M9 8h6",
    data: "M5 5h14v14H5zM5 10h14M5 15h14M10 5v14",
    report: "M6 3h12v18H6zM9 8h6M9 12h6M9 16h3",
    article: "M4 4h16v16H4zM8 8h3M8 12h3M8 16h3M13 8h3M13 12h3M13 16h3",
    thesis: "M5 4h11l3 3v13H5zM8 9h8M8 13h8M8 17h5M3 7v15h13",
    slides: "M3 5h18v11H3zM12 16v4M8 20h8M7 9h6",
    zip: "M6 3h12v18H6zM12 3v2M12 7v2M12 11v2M10.5 15h3v3h-3z",
    template: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
    arrowLeft: "M19 12H5M11 6l-6 6 6 6",
    more: "M6 12h.01M12 12h.01M18 12h.01",
    colLeft: "M3 5h18v14H3zM9 5v14M5 9h2M5 12h2",
    colMid: "M3 5h18v14H3zM8 5v14M16 5v14M10 9h4M10 12h4",
    colRight: "M3 5h18v14H3zM15 5v14M17 9h2M17 12h2",
    undo: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
    palette: "M12 3a9 9 0 0 0 0 18c1.1 0 1.5-.8 1.5-1.5 0-1.3-1-1.6-1-2.7 0-.8.7-1.3 1.5-1.3H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01",
    cpu: "M7 7h10v10H7zM10 10h4v4h-4zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4",
    chevronUp: "M6 15l6-6 6 6",
    replace: "M4 7h10M10 3l4 4-4 4M20 17H10M14 13l-4 4 4 4",
    replaceAll: "M3 6h9M9 3l3 3-3 3M3 12h9M3 18h9M15 15l3 3 3-3M18 9v9",
    regex: "M17 4v8M13.5 6l7 4M20.5 6l-7 4M5 17h4v4H5z",
    caseSensitive: "M3 18l4-11 4 11M4.5 14h5M14 13a3 3 0 1 1 0 .01M20 10v8",
    wholeWord: "M3 7v10M21 7v10M7 10l1.5 6 1.5-5 1.5 5L13 10M15 13a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
    wrap: "M4 6h16M4 12h13a3 3 0 0 1 0 6h-4M15 16l-2 2 2 2M4 18h5",
    disk: "M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6",
    compare: "M5 4h5v16H5zM14 4h5v16h-5zM7 8h1M7 12h1M16 8h1M16 16h1",
    selection: "M5 4h14v16H5zM9 9h6M9 13h4",
    minus: "M5 12h14",
    bold: "M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z",
    italic: "M10 5h8M6 19h8M14 5l-4 14",
    underline: "M7 4v7a5 5 0 0 0 10 0V4M5 20h14",
    heading: "M6 5v14M16 5v14M6 12h10M19 19h2",
    listBullet: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
    listNumber: "M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M3.5 14.5a1.5 1.5 0 0 1 3 .5c0 1-3 2-3 3.5h3",
    sigma: "M18 5H6l6 7-6 7h12",
    table: "M4 5h16v14H4zM4 10h16M4 15h16M10 5v14",
    quote: "M5 17c2-1 3-3 3-6H5V6h5v5c0 4-2 6.5-5 7.5zM14 17c2-1 3-3 3-6h-3V6h5v5c0 4-2 6.5-5 7.5z",
    env: "M8 5H5v14h3M16 5h3v14h-3M9 12h6",
    func: "M15 4h-2a3 3 0 0 0-3 3v13M7 10h7",
    fitWidth: "M4 5v14M20 5v14M8 12h8M10 9.5L7.5 12l2.5 2.5M14 9.5l2.5 2.5-2.5 2.5",
    fitPage: "M7 3h10v18H7zM10 8h4M10 11h4M10 14h2",
  } as const;
  export type IconName = keyof typeof PATHS;
  /** For DOM built outside Svelte (CodeMirror gutters and widgets). */
  export const iconPath = (n: IconName): string => PATHS[n];
</script>

<script lang="ts">
  let { name, size = 14 }: { name: IconName; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={PATHS[name]} />
</svg>
