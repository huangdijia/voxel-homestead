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

function agricultureIcon(id: string): React.ReactNode | null {
  if (id === "wheat_seeds" || id === "beetroot_seeds") {
    const beet = id === "beetroot_seeds";
    return (
      <>
        <path
          d="M3 3h3v2h1v2H4V6H2V4h1V3Zm7-1h2v1h2v3h-3V5H9V3h1V2ZM2 10h3v1h2v3H3v-1H1v-2h1v-1Zm8-2h3v2h1v3h-3v1H9v-4h1V8Z"
          fill={beet ? "#644438" : "#496633"}
        />
        <path
          d="M3 4h2v2H3V4Zm7-1h2v2h-2V3ZM2 11h3v1H2v-1Zm8-1h2v3h-2v-3Z"
          fill={beet ? "#b28a60" : "#a4bf53"}
        />
        <path
          d="M4 4h1v1H4V4Zm7 6h1v1h-1v-1ZM3 11h1v1H3v-1Z"
          fill={beet ? "#d7b687" : "#d0db86"}
        />
      </>
    );
  }
  if (id === "wheat")
    return (
      <>
        <path
          d="M7 3h1v11H6v1H4v-1h2v-3H4v-1H3V8h2v2h2V3Zm4-2h1v8h-1v3H9v2H8v-3h2V8h1V1Z"
          fill="#99833c"
        />
        <path
          d="M5 2h2v3H5V2Zm3-1h2v3H8V1ZM4 5h3v3H5V7H4V5Zm4-1h2v3H8V4ZM9 8h2v2H9V8Zm3-5h2v3h-2V3Zm-1 3h2v2h-2V6Z"
          fill="#e7bd53"
        />
        <path
          d="M5 2h1v2H5V2Zm3-1h1v2H8V1ZM4 5h2v1H4V5Zm4-1h1v2H8V4Zm4-1h1v2h-1V3Z"
          fill="#ffdf82"
        />
        <path d="M5 11h6v2H5v-2Z" fill="#b27a3f" />
      </>
    );
  if (id === "carrot")
    return (
      <>
        <path d="M10 1h2v3h2V2h1v4h-3v2H9V5H7V3h2v1h1V1Z" fill="#407839" />
        <path d="M10 1h1v4h-1V1Zm3 3h2v1h-2V4ZM8 3h1v2H8V3Z" fill="#85ad43" />
        <path
          d="M8 5h3v1h2v4h-2v2H8v1H6v1H4v1H2v-3h1V9h2V7h3V5Z"
          fill="#a44e22"
        />
        <path d="M8 6h3v1h1v2h-2v2H7v1H5v1H3v-1h1V9h2V8h2V6Z" fill="#ee8c2e" />
        <path d="M8 6h2v1H8V6ZM6 8h2v1H6V8Zm-2 3h2v1H4v-1Z" fill="#ffbd56" />
        <path d="M9 9h2v1H9V9Zm-3 2h2v1H6v-1Z" fill="#c46323" />
      </>
    );
  if (["potato", "poisonous_potato", "baked_potato"].includes(id)) {
    const poison = id === "poisonous_potato",
      baked = id === "baked_potato";
    return (
      <>
        <path
          d="M5 3h6v1h2v2h1v5h-2v2H9v1H4v-1H2v-2H1V7h1V5h3V3Z"
          fill={poison ? "#666b38" : baked ? "#85552e" : "#866039"}
        />
        <path
          d="M5 4h6v1h2v5h-2v2H8v1H4v-1H2V7h1V6h2V4Z"
          fill={poison ? "#a1ad50" : baked ? "#b58142" : "#c5a063"}
        />
        {baked ? (
          <>
            <path d="M5 5h6v1h1v3h-2v2H5v-1H3V8h1V6h1V5Z" fill="#f2d087" />
            <path d="M6 6h4v1H6V6ZM4 8h3v1H4V8Z" fill="#fff1bf" />
            <path d="M8 8h2v2H8V8Z" fill="#ddb258" />
          </>
        ) : (
          <>
            <path
              d="M5 4h4v1H5V4ZM3 6h2v2H3V6Z"
              fill={poison ? "#cbd784" : "#ead096"}
            />
            <path
              d="M10 6h1v2h-1V6ZM5 10h2v1H5v-1Zm3-2h1v1H8V8Z"
              fill={poison ? "#6c4d63" : "#937044"}
            />
            {poison && <path d="M4 8h2v2H4V8Zm5-4h2v2H9V4Z" fill="#738b3c" />}
          </>
        )}
      </>
    );
  }
  if (id === "beetroot")
    return (
      <>
        <path d="M7 6V2H5V1H3v3h2v2h2Zm2 0V3h1V1h3v3h-2v2H9Z" fill="#447a3d" />
        <path d="M4 2h1v2H4V2Zm7 0h1v2h-1V2Z" fill="#83aa53" />
        <path
          d="M7 3h1v4H7V3Zm2 1h1v3H9V4ZM5 6h6v1h2v5h-2v1H9v2H7v-2H4v-2H3V8h2V6Z"
          fill="#73374d"
        />
        <path d="M5 7h6v1h1v3h-2v1H6v-1H4V9h1V7Z" fill="#bb4b61" />
        <path d="M6 7h3v1H6V7ZM5 8h1v2H5V8Z" fill="#e87c88" />
        <path d="M8 13h1v2H8v-2Z" fill="#b77e78" />
      </>
    );
  if (id === "bread")
    return (
      <>
        <path
          d="M5 3h6v1h2v2h1v2h1v4h-2v1H3v-1H1V8h1V6h1V4h2V3Z"
          fill="#86572e"
        />
        <path d="M5 4h6v1h2v3h1v3H3v-1H2V8h1V6h2V4Z" fill="#d89d47" />
        <path d="M5 4h6v1H5V4ZM3 7h2v1H3V7Zm1 2h9v1H4V9Z" fill="#f1bc63" />
        <path d="M6 5h1v3H6V5Zm3 0h1v3H9V5Zm3 1h1v2h-1V6Z" fill="#a97635" />
        <path d="M6 5h1v1H6V5Zm3 0h1v1H9V5Z" fill="#f8da97" />
      </>
    );
  if (id === "bowl" || id === "beetroot_soup")
    return (
      <>
        <path d="M2 5h12v1h1v4h-2v3H3v-3H1V6h1V5Z" fill="#553b2b" />
        <path d="M2 6h12v3H2V6Z" fill={id === "bowl" ? "#795233" : "#a53e57"} />
        <path d="M3 6h10v1H3V6Z" fill={id === "bowl" ? "#9d7447" : "#e17682"} />
        <path d="M2 8h2v2h8V8h2v2h-2v2H4v-2H2V8Z" fill="#a77e4d" />
        <path d="M3 8h2v1H3V8Zm2 2h5v1H5v-1Z" fill="#d0a168" />
        {id === "beetroot_soup" && (
          <>
            <path d="M5 7h2v1H5V7Zm4-1h2v1H9V6Z" fill="#e5b5a1" />
            <path d="M9 8h2v1H9V8Z" fill="#7fa458" />
          </>
        )}
      </>
    );
  if (id === "bone_meal")
    return (
      <>
        <path
          d="M4 8h2V5h4v2h2v2h2v4H2v-3h2V8ZM3 2h2v2H3V2Zm8 0h2v3h-2V2Z"
          fill="#98a295"
        />
        <path
          d="M5 8h2V6h2v2h2v2h2v2H3v-1h2V8ZM3 2h2v1H3V2Zm8 0h1v2h-1V2Z"
          fill="#dce2ce"
        />
        <path d="M7 6h2v2H7V6Zm-2 4h2v1H5v-1Zm4-1h2v2H9V9Z" fill="#fbf8e2" />
      </>
    );
  if (id.endsWith("_hoe"))
    return (
      <>
        <path d="M6 2h8v2h-1v3h-3V5H9l-6 9H1v-2l7-9H6V2Z" fill="#35403c" />
        <path d="m2 12 7-9 1 1-7 9H2v-1Z" fill="#a6814b" />
        <path
          d="M6 2h7v1h-1v3h-2V4H9V3H6V2Z"
          fill={
            id.startsWith("iron")
              ? "#ccd9d7"
              : id.startsWith("stone")
                ? "#9caaa4"
                : "#c2a068"
          }
        />
        <path
          d="M6 2h6v1H6V2Z"
          fill={
            id.startsWith("iron")
              ? "#f1f1de"
              : id.startsWith("stone")
                ? "#c4c8b8"
                : "#e2bd7a"
          }
        />
      </>
    );
  if (id === "shears")
    return (
      <>
        <path
          d="M2 1h3v2h1v3h1v2h2V6h1V3h1V1h3v5h-1v2h-2v2h2v1h1v3h-1v1H9v-1H7v1H3v-1H2v-3h1v-1h2V8H3V6H2V1Z"
          fill="#48534e"
        />
        <path
          d="M3 2h1v2h1v3h2v2H6V8H4V6H3V2Zm9 0h1v4h-1v2h-2v1H9V7h2V4h1V2Z"
          fill="#d5e1dc"
        />
        <path d="M7 8h2v2H7V8Z" fill="#a3b3a9" />
        <path d="M3 11h3v3H3v-3Zm6 0h3v3H9v-3Z" fill="#a5a998" />
        <path d="M4 12h1v1H4v-1Zm6 0h1v1h-1v-1Z" fill="#39433f" />
      </>
    );
  if (id === "bucket" || id === "water_bucket")
    return (
      <>
        <path
          d="M4 2h8v1h2v3h1v4h-1v3h-2v2H4v-2H2v-3H1V6h1V3h2V2Z"
          fill="#52666a"
        />
        <path d="M4 3h8v1h1v3h-1V4H4v3H3V4h1V3Z" fill="#cad9d8" />
        <path d="M2 6h12v3h-1v3h-2v2H5v-2H3V9H2V6Z" fill="#a7b9bc" />
        <path
          d="M3 6h10v3H3V6Z"
          fill={id === "water_bucket" ? "#397fc0" : "#65797c"}
        />
        <path
          d="M3 6h10v1H3V6Z"
          fill={id === "water_bucket" ? "#78c5ed" : "#d7e0d8"}
        />
        <path d="M4 9h1v3H4V9Zm1 3h2v1H5v-1Z" fill="#e4e8db" />
        <path d="M11 9h1v3h-1V9Zm-2 3h2v1H9v-1Z" fill="#7d959a" />
      </>
    );
  if (id === "composter")
    return (
      <>
        <path d="M2 3h12v1h1v10H1V4h1V3Z" fill="#533d2b" />
        <path d="M3 2h10v1h2v3H1V3h2V2Z" fill="#a8824e" />
        <path d="M3 3h10v2H3V3Z" fill="#453a28" />
        <path d="M2 6h12v7H2V6Z" fill="#ac814a" />
        <path d="M4 6h1v7H4V6Zm4 0h1v7H8V6Zm4 0h1v7h-1V6Z" fill="#76552f" />
        <path d="M2 7h12v1H2V7Zm0 4h12v1H2v-1Z" fill="#d0aa6a" />
        <path d="M3 6h1v1H3V6Zm4 0h1v1H7V6Zm4 0h1v1h-1V6Z" fill="#e7bd79" />
      </>
    );
  if (id === "short_grass")
    return (
      <>
        <path
          d="M7 15V7H6V3H4v5h1v4H3V9H1v3h2v2h2v1h2Zm1 0V5h1V1h2v6h-1v4h1V8h3v3h-2v3h-2v1H8Z"
          fill="#447f39"
        />
        <path
          d="M5 4h1v5H5V4Zm4 1h1v7H9V5Zm3 4h1v2h-1V9ZM3 11h1v2H3v-2Z"
          fill="#8bab4b"
        />
      </>
    );
  return null;
}

export function ItemIcon({ id, size = 36 }: { id: string; size?: number }) {
  const item = ITEMS[id];
  if (!item) return null;
  const c = item.color || "#a6a795";
  const agriculture = agricultureIcon(id);
  if (agriculture)
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        shapeRendering="crispEdges"
        className="item-svg"
        aria-hidden="true"
      >
        {agriculture}
      </svg>
    );
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
