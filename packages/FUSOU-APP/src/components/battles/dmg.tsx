import { calc_critical } from "../../utility/battles";

interface DamageCommonProps {
  dmg: number;
  critical_flag: number | undefined;
}

export function DamageCommonComponent(props: DamageCommonProps) {
  return (
    <div
      class={`h-6 text-sm content-center ${calc_critical(props.dmg, props.critical_flag)}`}
    >
      {props.dmg}
    </div>
  );
}
