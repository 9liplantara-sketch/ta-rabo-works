"use client";

import type { FlowOption } from "@/data/process-flow/types";
import { colorForRole } from "@/data/process-flow/types";
import IconSvg from "./IconSvg";
import { ICONS } from "./iconPaths";
import { resolveIconKey } from "./resolveIcon";

interface OptionIconProps {
  option: FlowOption;
}

export default function OptionIcon({ option }: OptionIconProps) {
  const color = option.color ?? colorForRole(option.role);
  const key = resolveIconKey(option);

  return <IconSvg color={color}>{ICONS[key]}</IconSvg>;
}
