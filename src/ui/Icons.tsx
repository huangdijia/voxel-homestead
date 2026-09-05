import type { CSSProperties } from "react";
import { BLOCKS, ITEMS } from "../game/registry";
import type { ItemStack } from "../game/types";

export function Icon({
  name,
  size = 20,
  ...props
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const paths: Record<string, React.ReactNode> = {
    play: <path d="m8 4 12 8-12 8V4Z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <path d="M8 4v6m8 4v6" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4" />
      </>
    ),
    trash: (
      <>
        <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" />
      </>
    ),
    back: <path d="M19 12H5m6-6-6 6 6 6" />,
    check: <path d="m4 12 5 5L20 6" />,
    sun: (
      <>
        <rect x="8" y="8" width="8" height="8" />
        <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" />
      </>
    ),
    moon: <path d="M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11Z" />,
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 6 6" />
      </>
    ),
    cube: (
      <>
        <path d="m12 2 9 5v10l-9 5-9-5V7l9-5Z" />
        <path d="m3 7 9 5 9-5M12 12v10" />
      </>
    ),
    world: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z" />
      </>
    ),
    spark: (
      <path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z" />
    ),
    eye: (
      <>
        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7v1" />
      </>
    ),
    chevron: <path d="m8 5 7 7-7 7" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      {...props}
    >
      {paths[name] || paths.cube}
    </svg>
  );
}

export function ItemIcon({ id, size = 36 }: { id: string; size?: number }) {
  const item = ITEMS[id];
  if (!item) return null;
  const c = item.color || "#a6a795";
  if (
    item.block !== undefined &&
    item.texture !== undefined &&
    !["torch", "ladder", "door", "bed"].some((word) => id.includes(word))
  ) {
    const pos = `${((item.texture % 4) * 100) / 3}% ${(Math.floor(item.texture / 4) * 100) / 3}%`;
    const side = BLOCKS[item.block]?.texture ?? item.texture;
    const sidePos = `${((side % 4) * 100) / 3}% ${(Math.floor(side / 4) * 100) / 3}%`;
    return (
      <span
        className="item-cube"
        style={
          {
            width: size,
            height: size,
            "--tile-position": pos,
            "--tile-side-position": sidePos,
          } as CSSProperties
        }
        aria-hidden="true"
      >
        <i className="cube-top" />
        <i className="cube-left" />
        <i className="cube-right" />
      </span>
    );
  }
  const toolColor = id.startsWith("iron")
    ? "#c4d4d4"
    : id.startsWith("stone")
      ? "#9b9e9b"
      : "#bea36d";
  const pixel = (body: React.ReactNode) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      shapeRendering="crispEdges"
      className="item-svg"
      aria-hidden="true"
    >
      {body}
    </svg>
  );
  if (item.tool)
    return pixel(
      <>
        <path d="m3 12 8-8 2 2-8 8H3v-2Z" fill="#342c23" />
        <path d="m4 12 7-7 1 1-7 7H4v-1Z" fill="#967248" />
        {item.tool === "pickaxe" ? (
          <>
            <path d="M5 2h7v1h2v2h1v4h-2V6h-2V4H5V2Z" fill="#333c3b" />
            <path d="M5 2h7v1h2v2h-2V4h-1V3H5V2Z" fill={toolColor} />
            <path d="M14 5h1v3h-1V5Z" fill={toolColor} />
          </>
        ) : item.tool === "axe" ? (
          <>
            <path d="M8 1h5v2h2v5h-5V6H8V1Z" fill="#333c3b" />
            <path d="M9 2h4v2h1v3h-4V5H9V2Z" fill={toolColor} />
            <path d="M11 2h2v2h1v2h-1V4h-2V2Z" fill="#e0e0c9" />
          </>
        ) : item.tool === "sword" ? (
          <>
            <path d="M12 1h3v4l-6 6-4-4 7-6Z" fill="#39413d" />
            <path d="M13 2h1v3l-5 5-2-2 6-6Z" fill={toolColor} />
            <path d="m7 8 1 1 6-6V2h-1L7 8Z" fill="#e0e0c9" />
            <path d="m4 7 5 5-1 1-5-5 1-1Z" fill="#977d43" />
          </>
        ) : (
          <>
            <path d="M11 1h4v4l-4 4-4-4 4-4Z" fill="#35403e" />
            <path d="M11 2h3v3l-3 3-3-3 3-3Z" fill={toolColor} />
            <path d="M12 2h2v2h-2V2Z" fill="#e0e0c9" />
          </>
        )}
      </>,
    );
  if (item.armorSlot)
    return pixel(
      <>
        <path
          d={
            item.armorSlot === "head"
              ? "M3 3h10v9h-3V8H6v4H3V3Z"
              : item.armorSlot === "chest"
                ? "M2 3h4v2h4V3h4v6h-2v5H4V9H2V3Z"
                : item.armorSlot === "legs"
                  ? "M4 2h8v12H9V7H7v7H4V2Z"
                  : "M4 3h3v7h2V3h3v10H9v1H2v-3h2V3Z"
          }
          fill="#667777"
        />
        <path
          d={
            item.armorSlot === "head"
              ? "M4 4h8v3H5v4H4V4Z"
              : item.armorSlot === "chest"
                ? "M3 4h2v3h6V4h2v4h-2v5H5V8H3V4Z"
                : item.armorSlot === "legs"
                  ? "M5 3h6v3H6v7H5V3Z"
                  : "M5 4h1v8H3v-1h2V4Zm5 0h1v8h-1V4Z"
          }
          fill="#cad7d2"
        />
      </>,
    );
  if (id.includes("torch"))
    return pixel(
      <>
        <path d="M6 7h3v7H6V7Z" fill="#6d442b" />
        <path d="M6 7h1v6H6V7Z" fill="#b58d4f" />
        <path d="M5 3h5v5H5V3Z" fill="#f38924" />
        <path d="M6 1h2v2h1v3H6V1Z" fill="#fff2a0" />
        <path d="M7 4h2v2H7V4Z" fill="#ffd353" />
      </>,
    );
  if (id.includes("ladder"))
    return pixel(
      <>
        <path d="M3 1h2v14H3V1Zm8 0h2v14h-2V1Z" fill="#68482d" />
        <path d="M4 2h1v12H4V2Zm8 0h1v12h-1V2Z" fill="#b28b58" />
        <path d="M4 3h9v2H4V3Zm0 4h9v2H4V7Zm0 4h9v2H4v-2Z" fill="#ba9760" />
      </>,
    );
  if (id.includes("door"))
    return pixel(
      <>
        <path d="M4 1h9v14H4V1Z" fill="#65482b" />
        <path d="M5 2h7v12H5V2Z" fill="#ba9558" />
        <path d="M6 3h2v3H6V3Zm3 0h2v3H9V3ZM6 9h5v4H6V9Z" fill="#7f643c" />
        <path d="M10 7h1v1h-1V7Z" fill="#dfd5b0" />
      </>,
    );
  if (id.includes("bed"))
    return pixel(
      <>
        <path d="m1 8 8-4 6 2v5l-2 1v2h-2v-3l-6 2v2H3v-2H1V8Z" fill="#6d5136" />
        <path d="m1 7 8-4 6 2v4l-7 3-7-2V7Z" fill="#aaa999" />
        <path d="m1 7 8-4 6 2-8 4-6-2Z" fill="#f4f0d9" />
        <path d="m8 4 2-1 5 2-2 1-5-2Z" fill="#fff9e8" />
      </>,
    );
  if (id.includes("stick"))
    return pixel(
      <>
        <path d="m3 12 9-10h2v2L5 14H3v-2Z" fill="#543c2a" />
        <path d="m4 12 9-9v1l-9 9v-1Z" fill="#bf9760" />
      </>,
    );
  if (id.includes("coal") || id.includes("charcoal"))
    return pixel(
      <>
        <path d="M5 2h6v2h2v2h1v6h-3v2H5v-1H2V8h1V4h2V2Z" fill="#222a2c" />
        <path d="M5 3h5v2H6v2H4V5h1V3Z" fill="#566065" />
        <path d="M6 8h4v3H6V8Z" fill="#343e43" />
      </>,
    );
  if (id.includes("ingot"))
    return pixel(
      <>
        <path d="m2 7 3-3h8l2 4-3 4H3L1 9l1-2Z" fill="#536166" />
        <path d="m2 7 3-3h8l-2 4H2V7Z" fill="#d5dfd7" />
        <path d="M2 8h9v3H3L2 8Z" fill="#a4b9b2" />
        <path d="m11 8 2-4 1 4-3 3V8Z" fill="#7e918c" />
      </>,
    );
  if (item.food || id.includes("pork") || id.includes("mutton"))
    return pixel(
      <>
        <path
          d="M5 2h6v2h2v2h1v5h-3v2H5v1H2v-3h1V8H2V5h3V2Z"
          fill={id.includes("cooked") ? "#653f28" : "#89524f"}
        />
        <path
          d="M5 3h6v2h2v5h-3v2H5v1H3v-2h1V7H3V5h2V3Z"
          fill={id.includes("cooked") ? "#bc8554" : "#db9090"}
        />
        <path
          d="M6 4h4v1H6V4ZM4 8h2v3H4V8Z"
          fill={id.includes("cooked") ? "#dfb079" : "#f3c9af"}
        />
      </>,
    );
  return pixel(
    <>
      <path d="M5 2h6v2h2v2h1v6h-3v2H5v-1H2V8h1V4h2V2Z" fill="#4c4d43" />
      <path d="M5 3h5v2h2v6H9v2H5v-2H3V7h2V3Z" fill={c} />
      <path d="M5 3h4v2H6v2H4V5h1V3Z" fill="#d4c9aa" />
    </>,
  );
}

export function StackView({ stack }: { stack: ItemStack }) {
  const item = ITEMS[stack.id];
  return (
    <>
      <ItemIcon id={stack.id} />
      <span className="stack-count">{stack.count > 1 ? stack.count : ""}</span>
      {stack.durability !== undefined && item?.maxDurability && (
        <span className="durability">
          <i
            style={{
              width: `${Math.max(0, (stack.durability / item.maxDurability) * 100)}%`,
            }}
          />
        </span>
      )}
    </>
  );
}
