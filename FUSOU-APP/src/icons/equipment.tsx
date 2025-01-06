import { JSX } from 'solid-js';

interface EquipmentProps {
  icon_number: number;
  category_number: number;
}

// 1 "小口径主砲" 
// 2 "中口径主砲" 
// 3 "大口径主砲" 
// 4 "副砲" 
// 5 "魚雷" 
// 6 "艦上戦闘機" 
// 7 "艦上爆撃機" 
// 8 "艦上攻撃機" 
// 9 "艦上偵察機" 
// 10 "水上偵察機" 
// 11 "水上爆撃機" 
// 12 "小型電探" 
// 13 "大型電探" 
// 14 "ソナー" 
// 15 "爆雷" 
// 16 "追加装甲" 
// 17 "機関部強化" 
// 18 "対空強化弾" 
// 19 "対艦強化弾" 
// 20 "VT信管" 
// 21 "対空機銃" 
// 22 "特殊潜航艇" 
// 23 "応急修理要員" 
// 24 "上陸用舟艇" 
// 25 "オートジャイロ"
// 26 "対潜哨戒機" 
// 27 "追加装甲(中型)" 
// 28 "追加装甲(大型)" 
// 29 "探照灯"
// 30 "簡易輸送部材" 
// 31 "艦艇修理施設"
// 32 "潜水艦魚雷"
// 33 "照明弾"
// 34 "司令部施設"
// 35 "航空要員"
// 36 "高射装置"
// 37 "対地装備"
// 38 "大口径主砲（II）"
// 39 "水上艦要員"
// 40 "大型ソナー"
// 41 "大型飛行艇"
// 42 "大型探照灯"
// 43 "戦闘糧食"
// 44 "補給物資"
// 45 "水上戦闘機"
// 46 "特型内火艇"
// 47 "陸上攻撃機"
// 48 "局地戦闘機"
// 49 "陸上偵察機"
// 50 "輸送機材"
// 51 "潜水艦装備"
// 52 "陸戦部隊"
// 53 "大型陸上機"
// 54 "水上艦装備"
// 56 "噴式戦闘機"
// 57 "噴式戦闘爆撃機"
// 58 "噴式攻撃機"
// 59 "噴式偵察機"
// 93 "大型電探（II）"
// 94 "艦上偵察機（II）"
// 95 "副砲（II）"

const icon_list: { [key: number]: string[] } = {
   0: ["#FFFFFF", "#FFFFFF"], //  Undefined
   1: ["#CC3D3D", "#CC3D3D"], //  small-Range Primary Armament
   2: ["#CC3D3D", "#CC3D3D"], //  medium-Range Primary Armament
   3: ["#CC3D3D", "#CC3D3D"], //  large-Range Primary Armament
   4: ["#FFEA00", "#FFEA00"], //  Secondary Armament
   5: ["#5887AB", "#FFEA00"], //  Torpedo
   6: ["#39B74E", "#60C06F"], //  carrier-based fighter
   7: ["#39B74E", "#FF726F"], //  carrier-based dive bomber
   8: ["#39B74E", "#68C1FD"], //  carrier-based torpedo bomber
   9: ["#39B74E", "#FFD500"], //  carrier-based reconnaissance
  10: ["#8FCC98", "#8FCC98"], //  seaplane
  11: ["#DE9437", "#DE9437"], //  radar
  12: ["#46B158", "#46B158"], //  AA shell
  13: ["#D15B5B", "#D15B5B"], //  AP shell
  14: ["#FFFFFF", "#000000"], //  Damage control
  15: ["#66CC77", "#66CC77"], //  AA gun
  16: ["#66CC77", "#66CC77"], //  High-angle gun
  17: ["#7FCCD8", "#7FCCD8"], //  Depth Charge
  18: ["#7FCCD8", "#7FCCD8"], //  Sonar
  19: ["#FFC44C", "#FFC44C"], //  Engine Upgrades
  20: ["#9AA55D", "#9AA55D"], //  Landing Craft
  21: ["#65CA76", "#65CA76"], //  Autogyro
  22: ["#7FCCD8", "#7FCCD8"], //  AntiSubmarine Patrol
  23: ["#997EAE", "#997EAE"], //  Extension Armor
  24: ["#E76B19", "#E76B19"], //  Searchlight
  25: ["#A3A3A3", "#A3A3A3"], //  Supply
  26: ["#B09D7F", "#B09D7F"], //  Machine Tools
  27: ["#FF9A00", "#FF9A00"], //  Flare
  28: ["#CDB1FD", "#CDB1FD"], //  Fleet Command
  29: ["#CDA269", "#CDA269"], //  Maintenance Team
  30: ["#899A4D", "#899A4D"], //  AA Director
  31: ["#FF3637", "#FF3637"], //  Rocket Artillery
  32: ["#BFEB9F", "#BFEB9F"], //  Picket Crew
  33: ["#8FCC98", "#8FCC98"], //  Flying Boat
  34: ["#FFFFFF", "#000000"], //  Ration
  35: ["#61C59E", "#61C59E"], //  Supply
  36: ["#9AA55C", "#9AA55C"], //  Amphibious Vehicle
  37: ["#39B74E", "#38B012"], //  Land Attacker
  38: ["#39B74E", "#87D296"], //  local fighter
  39: ["#48B38F", "#EEB60D"], //  Jet Fight Bomber Keiun
  40: ["#48B38F", "#EEB60D"], //  Jet Fight Bomber Kikka
  41: ["#438358", "#438358"], //  Transport Materials
  42: ["#9FBCE3", "#9FBCE3"], //  Submarine Equipment
  43: ["#8BC595", "#8BC595"], //  Seaplane Fighter
  44: ["#39B74E", "#9CF5AD"], //  Army Fighter
  45: ["#39B74E", "#7976A0"], //  Night Fighter
  46: ["#39B74E", "#7976A0"], //  Night Attacker
  47: ["#39B74E", "#5263BC"], //  Land anti-submarine patrol
  48: ["#000000", "#000000"], //  Unknown
  49: ["#2E8E06", "#3A9F22"], //  Unknown
  50: ["#000000", "#000000"], //  Unknown
  51: ["#000000", "#000000"], //  Unknown
  52: ["#000000", "#000000"], //  Unknown
  53: ["#000000", "#000000"], //  Unknown
  54: ["#000000", "#000000"], //  Unknown
  55: ["#000000", "#000000"], //  Unknown
  56: ["#000000", "#000000"], //  Unknown
  57: ["#000000", "#000000"], //  Unknown
};

const category_list: { [key: number]: string } = {
   0: "  ",   //  Undefined
   1: "PA",   //  Primary Armament
   2: "SA",   //  Secondary Armament
   3: "TO",   //  Torpedo
   4: "MS",   //  Midget Submarine
   5: "CA",   //  Carrier-Based Aircraft
   6: "AA",   //  AA Gun
   7: "RE",   //  Reconnaissance
   8: "RA",   //  Radar
   9: "UP",   //  Upgrades
  10: "SO",   //  Sonar
  14: "LC",   //  Landing Craft
  15: "AG",   //  Autogyro
  16: "AS",   //  AntiSubmarine Patrol
  17: "EA",   //  Extension Armor
  18: "SL",   //  Searchlight
  19: "SU",   //  Supply
  20: "MT",   //  Machine Tools
  21: "FL",   //  Flare
  22: "FC",   //  Fleet Command
  23: "MT",   //  Maintenance Team
  24: "AA",   //  AA Director
  25: "AP",   //  AP Shell
  26: "RA",   //  Rocket Artillery
  27: "PC",   //  Picket Crew
  28: "AA",   //  AA Shell
  29: "AA",   //  AA Rocket
  30: "DC",   //  Damage Control
  31: "EU",   //  Engine Upgrades
  32: "DC",   //  Depth Charge
  33: "FB",   //  Flying Boat
  34: "RA",   //  Ration
  35: "SU",   //  Supply
  36: "MS",   //  Multi-purpose Seaplane
  37: "AV",   //  Amphibious Vehicle
  38: "LA",   //  Land Attacker
  39: "IN",   //  Interceptor
  40: "JB",   //  Jet Fighting Bomber
  41: "TM",   //  Transport Materials
  42: "SE",   //  Submarine Equipment
  43: "MS",   //  Multi-purpose Seaplane
  44: "HE",   //  Helicopter
  45: "DD",   //  DD Tank
  46: "HB",   //  Heavy Bomber
  47: "UN",   //  Unknown
  48: "UN",   //  Unknown
};
 
export function IconEquipment({icon_number, category_number, ...props}: JSX.HTMLAttributes<SVGSVGElement> & EquipmentProps) {

  let primary_color: string = icon_list[icon_number ?? 0][0];
  let secondary_color: string = icon_list[icon_number ?? 0][1];

  return (
    <svg 
      fill="currentColor"
      stroke-width="1.5" 
      stroke="currentColor" 
      viewBox="0 0 151 151"
      xmlns="http://www.w3.org/2000/svg" 
      xmlns:xlink="http://www.w3.org/1999/xlink" 
      overflow="hidden" 
      {...props}>
      {/* <defs>
        <filter id="fx0" x="-10%" y="-10%" width="120%" height="120%" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse">
          <feComponentTransfer color-interpolation-filters="sRGB">
            <feFuncR type="discrete" tableValues="0 0"/>
            <feFuncG type="discrete" tableValues="0 0"/>
            <feFuncB type="discrete" tableValues="0 0"/>
            <feFuncA type="linear" slope="0.4" intercept="0"/>
            </feComponentTransfer>
          <feGaussianBlur stdDeviation="1.28046 1.28046"/>
        </filter>
        <clipPath id="clip1">
          <rect x="0" y="0" width="151" height="151"/>
        </clipPath>
        <clipPath id="clip2">
          <rect x="21" y="43" width="119" height="71"/>
        </clipPath>
      </defs> */}
      {/* <g clip-path="url(#clip1)"> */}
        {/* <rect x="0" y="0" width="151" height="151" fill="#FFFFFF"/> */}
        {/* <g clip-path="url(#clip2)" filter="url(#fx0)" transform="translate(-4 -4)">
          <g>
            <path d="M53.5-2.85938C53.7344-2.17188 53.8672-1.61719 53.8828-1.19531 53.8984-0.773438 53.7812-0.453125 53.5312-0.234375 53.2812-0.015625 52.8672 0.125 52.2891 0.1875 51.7109 0.25 50.9375 0.28125 49.9688 0.28125 49 0.28125 48.2266 0.257812 47.6484 0.210938 47.0703 0.164062 46.6328 0.0859375 46.3359-0.0234375 46.0391-0.132812 45.8203-0.28125 45.6797-0.46875 45.5391-0.65625 45.4062-0.890625 45.2812-1.17188L40.0781-15.9375 14.8594-15.9375 9.89062-1.35938C9.79688-1.07812 9.67188-0.835937 9.51562-0.632812 9.35938-0.429688 9.13281-0.257812 8.83594-0.117188 8.53906 0.0234375 8.11719 0.125 7.57031 0.1875 7.02344 0.25 6.3125 0.28125 5.4375 0.28125 4.53125 0.28125 3.78906 0.242187 3.21094 0.164062 2.63281 0.0859375 2.22656-0.0625 1.99219-0.28125 1.75781-0.5 1.64844-0.820312 1.66406-1.24219 1.67969-1.66406 1.8125-2.21875 2.0625-2.90625L22.4062-59.25C22.5312-59.5937 22.6953-59.875 22.8984-60.0938 23.1016-60.3125 23.3984-60.4844 23.7891-60.6094 24.1797-60.7344 24.6797-60.8203 25.2891-60.8672 25.8984-60.9141 26.6719-60.9375 27.6094-60.9375 28.6094-60.9375 29.4375-60.9141 30.0938-60.8672 30.75-60.8203 31.2812-60.7344 31.6875-60.6094 32.0938-60.4844 32.4062-60.3047 32.625-60.0703 32.8438-59.8359 33.0156-59.5469 33.1406-59.2031ZM27.375-52.5938 27.3281-52.5938 16.875-22.3594 37.9688-22.3594ZM108.923-2.85938C109.173-2.17188 109.306-1.61719 109.322-1.19531 109.337-0.773438 109.22-0.453125 108.97-0.234375 108.72-0.015625 108.306 0.125 107.728 0.1875 107.15 0.25 106.376 0.28125 105.408 0.28125 104.439 0.28125 103.665 0.257812 103.087 0.210938 102.509 0.164062 102.072 0.0859375 101.775-0.0234375 101.478-0.132812 101.259-0.28125 101.118-0.46875 100.978-0.65625 100.845-0.890625 100.72-1.17188L95.5169-15.9375 70.2982-15.9375 65.3294-1.35938C65.2357-1.07812 65.1107-0.835937 64.9544-0.632812 64.7982-0.429688 64.5716-0.257812 64.2747-0.117188 63.9779 0.0234375 63.556 0.125 63.0091 0.1875 62.4622 0.25 61.7513 0.28125 60.8763 0.28125 59.9701 0.28125 59.2279 0.242187 58.6497 0.164062 58.0716 0.0859375 57.6654-0.0625 57.431-0.28125 57.1966-0.5 57.0872-0.820312 57.1029-1.24219 57.1185-1.66406 57.2513-2.21875 57.5013-2.90625L77.8451-59.25C77.9701-59.5937 78.1341-59.875 78.3372-60.0938 78.5404-60.3125 78.8372-60.4844 79.2279-60.6094 79.6185-60.7344 80.1185-60.8203 80.7279-60.8672 81.3372-60.9141 82.1107-60.9375 83.0482-60.9375 84.0482-60.9375 84.8763-60.9141 85.5326-60.8672 86.1888-60.8203 86.7201-60.7344 87.1263-60.6094 87.5326-60.4844 87.8451-60.3047 88.0638-60.0703 88.2826-59.8359 88.4544-59.5469 88.5794-59.2031ZM82.8138-52.5938 82.7669-52.5938 72.3138-22.3594 93.4076-22.3594Z" transform="translate(25.0707 109)"/>
          </g>
        </g> */}
        <text font-family="monospace,sans-serif" font-weight="400" font-size="96" transform="translate(25 104)">
          {category_list[category_number ?? 0]}
        </text>
        <path d="M9 32C9 19.85 18.85 10 31 10L119 10C131.15 10 141 19.85 141 32L141 120C141 132.15 131.15 142 119 142L31 142C18.85 142 9 132.15 9 120Z" stroke="#000000" stroke-width="4" stroke-linejoin="round" stroke-miterlimit="10" fill="none" fill-rule="evenodd"/>
        <path d="M28 124 76 124" stroke={primary_color} stroke-width="16" stroke-miterlimit="8" fill="none" fill-rule="evenodd"/>
        <path d="M76 124 124 124" stroke={secondary_color} stroke-width="16" stroke-miterlimit="8" fill="none" fill-rule="evenodd"/>
        {/* <path d="M99 124 111 124" stroke={"#2D9C45"} stroke-width="6" stroke-miterlimit="8" fill="none" fill-rule="evenodd"/> */}
        {/* <path d="M111 124 123 124" stroke={"#FF100C"} stroke-width="6" stroke-miterlimit="8" fill="none" fill-rule="evenodd"/> */}
      {/* </g> */}
    </svg>
  )
}
export default IconEquipment

       // d="M36.042,13.909c-0.123-0.377-0.456-0.646-0.85-0.688l-11.549-1.172L18.96,1.43c-0.16-0.36-0.519-0.596-0.915-0.596 s-0.755,0.234-0.915,0.598L12.446,12.05L0.899,13.221c-0.394,0.04-0.728,0.312-0.85,0.688c-0.123,0.377-0.011,0.791,0.285,1.055 l8.652,7.738L6.533,34.045c-0.083,0.387,0.069,0.787,0.39,1.02c0.175,0.127,0.381,0.191,0.588,0.191 c0.173,0,0.347-0.045,0.503-0.137l10.032-5.84l10.03,5.84c0.342,0.197,0.77,0.178,1.091-0.059c0.32-0.229,0.474-0.633,0.391-1.02 l-2.453-11.344l8.653-7.737C36.052,14.699,36.165,14.285,36.042,13.909z M25.336,21.598c-0.268,0.24-0.387,0.605-0.311,0.957 l2.097,9.695l-8.574-4.99c-0.311-0.182-0.695-0.182-1.006,0l-8.576,4.99l2.097-9.695c0.076-0.352-0.043-0.717-0.311-0.957 l-7.396-6.613l9.87-1.002c0.358-0.035,0.668-0.264,0.814-0.592l4.004-9.077l4.003,9.077c0.146,0.328,0.456,0.557,0.814,0.592 l9.87,1.002L25.336,21.598z"