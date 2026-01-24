const paths = {
  add: "M12 4v6H6v4h6v6h4v-6h6v-4h-6V4z",
  erase: "M4 14l6-6 6 6-4 4H8z",
  fill: "M12 3l6 9h-4v7H10v-7H6z",
  clear: "M6 6l12 12M18 6L6 18",
  save: "M5 4h10l4 4v12H5z M7 4v6h8V4 M8 18h8v-4H8z",
  share: "M15 8l4-3v14l-4-3v2H6V6h9z",
  paste: "M8 4h8v2h2v14H6V6h2z M9 9h6v2H9z M9 13h6v2H9z",
  randomize:
    "M7 7h7l-2-2 1.4-1.4L17.8 8l-4.4 4.4L12 11l2-2H8v4H6V7z M17 17h-7l2 2-1.4 1.4L6.2 16l4.4-4.4L12 13l-2 2h5v-4h2v6z",
  delete:
    "M7 6h10l-1 14H8L7 6zm2-3h6l1 2H8l1-2z",
};

export default function ToolIcon({ name }) {
  return (
    <svg className="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
      {name === "clear" ? (
        <path d={paths.clear} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      ) : (
        <path d={paths[name]} fill="currentColor" />
      )}
    </svg>
  );
}
