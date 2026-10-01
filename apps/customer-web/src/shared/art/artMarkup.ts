// Verbatim SVG fragments copied from the approved customer reference
// (design/reference/approved/washgo-payments-interactive.html). They are kept as
// literal markup, not re-drawn JSX, so the artwork cannot drift from the golden
// source; tests/unit/c003-customer-home.test.mjs asserts each fragment is still a
// byte-exact substring of that file.

export const referenceArtDefs: readonly string[] = [
  `<linearGradient id="carBody" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="#fcfff6"/><stop offset=".32" stop-color="#d9e7d3"/><stop offset=".68" stop-color="#a8bda4"/><stop offset=".72" stop-color="#cfdcc6"/><stop offset="1" stop-color="#849d83"/></linearGradient>`,
  `<linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#6b9391"/><stop offset=".35" stop-color="#263f3f"/><stop offset="1" stop-color="#142b2b"/></linearGradient>`,
  `<radialGradient id="rim"><stop stop-color="#8ca499"/><stop offset=".5" stop-color="#456356"/><stop offset=".6" stop-color="#adc0b1"/><stop offset=".75" stop-color="#2e473b"/><stop offset="1" stop-color="#12231e"/></radialGradient>`,
  `<linearGradient id="studio-bg" x2=".7" y2="1"><stop stop-color="#183327"/><stop offset="1" stop-color="#263d28"/></linearGradient>`,
  `<radialGradient id="studio-halo"><stop stop-color="#bfd481" stop-opacity=".4"/><stop offset="1" stop-color="#bfd481" stop-opacity="0"/></radialGradient>`,
  `<linearGradient id="dust-wash" x2="0" y2="1"><stop stop-color="#ab9671" stop-opacity=".15"/><stop offset="1" stop-color="#857450" stop-opacity=".82"/></linearGradient>`,
  `<clipPath id="dust-clip"><path d="M39 137q6-15 37-19l53-24h143l49 25 61 8q18 1 21 18l-8 22H43Z"/></clipPath>`,
];

export const referenceCarSymbols: readonly string[] = [
  `<symbol id="car-sedan" viewBox="0 0 440 210">
<ellipse cx="225" cy="178" rx="187" ry="10" fill="#061b13" opacity=".25"/>
<path d="m40 136 12-16 71-11 43-33q12-8 30-8h50q26 0 45 17l40 31 48 7q21 3 26 20v20l-16 10H45l-10-14v-15Z" fill="url(#carBody)" stroke="#8daba0" stroke-width=".9"/>
<path d="m127 112 43-31q13-8 29-8h45q21 0 38 15l30 25Z" fill="#132d29" stroke="#e9f1e5" stroke-width="2.2"/>
<path d="m138 109 35-24q10-7 26-7h13l-5 32Z" fill="url(#glass)"/>
<path d="m218 78 25 1q21 0 36 14l20 17-84 0Z" fill="url(#glass)"/>
<path d="m168 83 38-9h42q24 3 40 22" fill="none" stroke="#c9e8e6" stroke-width="1.4" opacity=".7"/>
<path d="M214 75v39m-91 3-7 35m99-36-3 39m93-39 8 33" fill="none" stroke="#52736a" stroke-width=".8" opacity=".6"/>
<path d="m48 136 67-15 219 1 62 12" fill="none" stroke="#f8fff4" stroke-width="2" opacity=".92"/>
<path d="m50 152 79 2 184-5 82-6" fill="none" stroke="#617f75" stroke-width="1" opacity=".6"/>
<path d="M112 164h199" stroke="#293d32" stroke-width="6"/>
<path d="M49 173v-15a37 37 0 0 1 74 0v15m181 0v-15a37 37 0 0 1 74 0v15" fill="#243a2e"/>
<circle cx="86" cy="161" r="31" fill="#11251a"/><circle cx="86" cy="161" r="23" fill="url(#rim)"/><circle cx="341" cy="161" r="31" fill="#11251a"/><circle cx="341" cy="161" r="23" fill="url(#rim)"/>
<g stroke="#d0dfd2" stroke-width="2.4"><path d="m86 141 4 14 14-1m-2 19-13-8-10 10m-12-21 14 4 3 20m257-37 4 14 14-1m-2 19-13-8-10 10m-12-21 14 4 3 20"/></g>
<circle cx="86" cy="161" r="5" fill="#bdcfbf"/><circle cx="341" cy="161" r="5" fill="#bdcfbf"/>
<path d="m352 131 40 3-1 5-36-2-8 6" fill="none" stroke="#e8fff8" stroke-width="3.5"/>
<path d="m46 133 38-7 8 2" fill="none" stroke="#b8545e" stroke-width="3.2"/>
<path d="m376 150 21-2-4 12-19 3Z" fill="#233b2e"/><path d="M47 157h-9l5 7h5" fill="#395645"/>
<path d="m297 107 12-1 9 7-13 1Z" fill="#334f41" stroke="#92ae99"/>
<path d="M175 122h16m89 0h14" stroke="#5b7d67" stroke-width="2.8" stroke-linecap="round"/>
<path d="M133 165h166" stroke="#cadbc7" stroke-width="1.1"/>
</symbol>`,
  `<symbol id="car-suv" viewBox="0 0 440 210"><ellipse cx="224" cy="179" rx="183" ry="13" fill="#00180e" opacity=".12"/><path d="M47 116 71 66q5-17 26-17h169q15 0 26 14l37 49 56 13q17 5 18 23v25H42v-32q-1-18 5-25Z" fill="url(#carBody)" stroke="#688172" stroke-width="1.5"/><path d="m78 68-16 46h252l-29-43q-7-10-19-10H94q-11 0-16 7Z" fill="url(#glass)" stroke="#c5d8c4" stroke-width="2"/><path d="M142 61v54m66-54v54M53 131l322-4" stroke="#9bbda8" stroke-width="4"/><path d="M53 158h333" stroke="#365940" stroke-width="8"/><path d="M62 174v-13a37 37 0 0 1 74 0v13m160 0v-13a37 37 0 0 1 74 0v13" fill="#24382b"/><circle cx="99" cy="164" r="31" fill="#16281f"/><circle cx="99" cy="164" r="23" fill="url(#rim)"/><circle cx="333" cy="164" r="31" fill="#16281f"/><circle cx="333" cy="164" r="23" fill="url(#rim)"/><path d="M99 145v38m-19-19h38m215-19v38m-19-19h38" stroke="#afc8b1" stroke-width="4"/><path d="m348 132 41 5v9h-40Z" fill="#eafff1"/><path d="M147 122h16m72 0h16" stroke="#56765e" stroke-width="4"/><path d="M60 121h-15v20h13" fill="#a65d61"/><path d="M110 43h154" stroke="#647d6a" stroke-width="5"/></symbol>`,
  `<symbol id="car-pickup" viewBox="0 0 440 210"><ellipse cx="220" cy="180" rx="188" ry="11" fill="#00180e" opacity=".13"/><path d="M37 100h117V61q0-9 12-10h89q17 0 27 15l37 44 62 12q18 5 20 20v34H34V107q0-7 3-7Z" fill="url(#carBody)" stroke="#657e69" stroke-width="1.5"/><path d="M166 111V65h83q14 0 21 11l25 35Z" fill="url(#glass)" stroke="#c7d7c0" stroke-width="2"/><path d="M218 63v49M45 112h103v41M51 157h325" stroke="#66826b" stroke-width="3"/><path d="M50 176v-14a39 39 0 0 1 78 0v14m167 0v-14a39 39 0 0 1 78 0v14" fill="#20372a"/><circle cx="89" cy="166" r="31" fill="#15291e"/><circle cx="89" cy="166" r="24" fill="url(#rim)"/><circle cx="334" cy="166" r="31" fill="#15291e"/><circle cx="334" cy="166" r="24" fill="url(#rim)"/><path d="M89 146v40m-20-20h40m225-20v40m-20-20h40" stroke="#bfd1bd" stroke-width="4"/><path d="M348 134h39v12h-39Z" fill="#e6fbee"/><path d="M183 122h14m49 0h15" stroke="#53755b" stroke-width="4"/></symbol>`,
];
