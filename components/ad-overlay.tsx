"use client";

import { useEffect, useState } from "react";

const ADS: string[] = [
  // Ad 1: Miller's Miracle Metal Detectors
  `<div style="width:370px;max-width:95vw;background:#FFD600;border:3px solid #CC0000;position:relative;">
  <div style="background:#CC0000;padding:5px 10px;display:flex;justify-content:space-between;align-items:center;">
    <span style="color:white;font-size:9px;letter-spacing:2px;">★ SPONSORED — HOCKEY POOL ★</span>
    <button data-ad-close style="background:#FFD600;border:2px solid #FFD600;color:#CC0000;width:19px;height:19px;cursor:pointer;font-weight:900;font-size:13px;display:flex;align-items:center;justify-content:center;padding:0;line-height:1;">✕</button>
  </div>
  <div style="padding:14px 18px 12px;text-align:center;position:relative;overflow:hidden;">
    <div style="position:absolute;top:8px;right:8px;width:54px;height:54px;display:flex;align-items:center;justify-content:center;overflow:hidden;">
      <div style="position:absolute;background:#FF5500;width:54px;height:13px;opacity:0.65;border-radius:2px;"></div>
      <div style="position:absolute;background:#FF5500;width:54px;height:13px;transform:rotate(45deg);opacity:0.65;border-radius:2px;"></div>
      <div style="position:absolute;background:#FF5500;width:54px;height:13px;transform:rotate(90deg);opacity:0.65;border-radius:2px;"></div>
      <div style="position:absolute;background:#FF5500;width:54px;height:13px;transform:rotate(135deg);opacity:0.65;border-radius:2px;"></div>
      <div style="position:absolute;background:#FFD600;width:34px;height:34px;border-radius:50%;"></div>
      <span style="position:relative;font-size:8px;font-weight:900;color:#CC0000;font-family:Impact,'Arial Black',sans-serif;line-height:1.1;">NEW!</span>
    </div>
    <div style="position:absolute;top:10px;left:8px;width:48px;height:48px;display:flex;align-items:center;justify-content:center;overflow:hidden;">
      <div style="position:absolute;background:#CC0000;width:48px;height:11px;opacity:0.5;border-radius:2px;"></div>
      <div style="position:absolute;background:#CC0000;width:48px;height:11px;transform:rotate(60deg);opacity:0.5;border-radius:2px;"></div>
      <div style="position:absolute;background:#CC0000;width:48px;height:11px;transform:rotate(120deg);opacity:0.5;border-radius:2px;"></div>
      <div style="position:absolute;background:#FFD600;width:30px;height:30px;border-radius:50%;"></div>
      <span style="position:relative;font-size:7px;font-weight:900;color:#1a1a1a;font-family:Impact,'Arial Black',sans-serif;line-height:1.15;text-align:center;">AS SEEN<br>ON TV</span>
    </div>
    <div style="padding-top:30px;">
      <div style="font-family:Impact,'Arial Black',sans-serif;font-size:12px;color:#1a1a1a;letter-spacing:3px;text-transform:uppercase;margin-bottom:1px;">Miller's</div>
      <div style="font-family:Impact,'Arial Black',sans-serif;font-size:28px;color:#CC0000;line-height:0.92;text-transform:uppercase;">Miracle<br>Metal Detectors</div>
    </div>
    <div style="border-top:2px solid #CC0000;margin:9px 0 7px;"></div>
    <div style="font-family:'Times New Roman',Georgia,serif;font-style:italic;font-size:15px;color:#1a1a1a;margin-bottom:10px;line-height:1.3;">
      "For haystacks and ladies' backs"
    </div>
    <div style="border:1.5px solid #CC0000;border-radius:4px;overflow:hidden;position:relative;">
      <svg viewBox="0 0 320 195" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;">
        <rect x="0" y="0" width="320" height="195" fill="#C5CED8"/>
        <rect x="0" y="0" width="320" height="130" fill="#D8E0E8"/>
        <rect x="8" y="35" width="52" height="90" rx="3" fill="#B0BEC5"/>
        <rect x="14" y="42" width="40" height="25" rx="2" fill="#90A4AE"/>
        <rect x="18" y="70" width="32" height="8" rx="1" fill="#78909C"/>
        <rect x="18" y="82" width="32" height="8" rx="1" fill="#78909C"/>
        <rect x="262" y="20" width="50" height="115" rx="3" fill="#B0BEC5"/>
        <rect x="268" y="28" width="38" height="28" rx="2" fill="#78909C"/>
        <circle cx="287" cy="72" r="12" fill="#90A4AE"/>
        <circle cx="287" cy="72" r="7" fill="#607D8B"/>
        <rect x="38" y="10" width="4" height="120" rx="2" fill="#90A4AE"/>
        <rect x="24" y="10" width="32" height="3" rx="1" fill="#90A4AE"/>
        <rect x="0" y="148" width="320" height="47" fill="#B8C4CC"/>
        <line x1="0" y1="148" x2="320" y2="148" stroke="#A0ADB8" stroke-width="1"/>
        <rect x="130" y="72" width="62" height="76" rx="6" fill="#3E8F94"/>
        <polygon points="161,72 150,82 172,82" fill="#2D6B70"/>
        <line x1="132" y1="82" x2="104" y2="118" stroke="#3E8F94" stroke-width="14" stroke-linecap="round"/>
        <ellipse cx="102" cy="121" rx="9" ry="8" fill="#80CBC4"/>
        <line x1="190" y1="80" x2="218" y2="44" stroke="#3E8F94" stroke-width="14" stroke-linecap="round"/>
        <ellipse cx="221" cy="41" rx="9" ry="8" fill="#80CBC4" transform="rotate(-40 221 41)"/>
        <rect x="152" y="54" width="18" height="20" rx="4" fill="#DABA9A"/>
        <circle cx="161" cy="46" r="22" fill="#DABA9A"/>
        <ellipse cx="161" cy="32" rx="24" ry="13" fill="#3E8F94"/>
        <rect x="137" y="32" width="48" height="8" rx="0" fill="#3E8F94"/>
        <rect x="136" y="38" width="50" height="5" rx="2" fill="#2D6B70"/>
        <ellipse cx="153" cy="45" rx="3" ry="3.5" fill="white"/>
        <ellipse cx="169" cy="45" rx="3" ry="3.5" fill="white"/>
        <circle cx="154" cy="46" r="2" fill="#3E3E3E"/>
        <circle cx="170" cy="46" r="2" fill="#3E3E3E"/>
        <rect x="146" y="52" width="30" height="18" rx="4" fill="#7EC8CC"/>
        <line x1="161" y1="52" x2="161" y2="70" stroke="#5BB5B8" stroke-width="0.8"/>
        <path d="M146 56 Q138 60 140 66" fill="none" stroke="#7EC8CC" stroke-width="2" stroke-linecap="round"/>
        <path d="M176 56 Q184 60 182 66" fill="none" stroke="#7EC8CC" stroke-width="2" stroke-linecap="round"/>
        <rect x="215" y="24" width="36" height="9" rx="2" fill="white" stroke="#1565C0" stroke-width="1" transform="rotate(-40 233 28)"/>
        <rect x="217" y="25" width="20" height="7" rx="1" fill="#90CAF9" transform="rotate(-40 227 28)"/>
        <rect x="213" y="23" width="4" height="11" rx="1" fill="#455A64" transform="rotate(-40 215 28)"/>
        <rect x="248" y="25" width="8" height="7" rx="1" fill="#FF8F00" transform="rotate(-40 252 28)"/>
        <rect x="255" y="27" width="16" height="3" rx="1" fill="#CFD8DC" transform="rotate(-40 263 28)"/>
        <path d="M264 17 Q270 11 272 4 Q274 -1 270 -4" fill="none" stroke="#42A5F5" stroke-width="1.5" stroke-dasharray="3,2"/>
        <ellipse cx="266" cy="14" rx="3.5" ry="4.5" fill="#42A5F5" transform="rotate(-55 266 14)"/>
        <ellipse cx="271" cy="7" rx="3" ry="4" fill="#64B5F6" transform="rotate(-65 271 7)"/>
        <ellipse cx="272" cy="1" rx="2.5" ry="3" fill="#90CAF9" transform="rotate(-70 272 1)"/>
        <g opacity="0.28" font-family="Arial" font-weight="bold" font-size="15" fill="white" letter-spacing="1">
          <text transform="rotate(-35, 80, 70)" x="10" y="70">iStock</text>
          <text transform="rotate(-35, 200, 70)" x="130" y="70">iStock</text>
          <text transform="rotate(-35, 80, 130)" x="10" y="130">iStock</text>
          <text transform="rotate(-35, 200, 130)" x="130" y="130">iStock</text>
          <text transform="rotate(-35, 80, 190)" x="10" y="190">iStock</text>
          <text transform="rotate(-35, 260, 100)" x="190" y="100">iStock</text>
          <text transform="rotate(-35, 260, 160)" x="190" y="160">iStock</text>
        </g>
        <rect x="0" y="180" width="320" height="15" fill="#1a1a1a" opacity="0.55"/>
        <text x="5" y="190" font-family="Arial" font-size="7.5" fill="white">© iStock / GettyImages  |  Male anesthesiologist preparing injection syringe in OR  |  Editorial use only</text>
      </svg>
    </div>
    <div style="font-size:9.5px;color:#1a1a1a;margin:8px 0 10px;font-family:Arial;line-height:1.7;text-align:left;padding:0 4px;">
      ✓ &nbsp;Detects needles &nbsp;&nbsp;&nbsp; ✓ &nbsp;Detects haystacks<br>
      ✓ &nbsp;Epidural-grade precision
    </div>
    <button style="background:#CC0000;color:#FFD600;border:none;padding:11px 0;font-family:Impact,'Arial Black',sans-serif;font-size:22px;text-transform:uppercase;cursor:pointer;letter-spacing:1px;width:100%;display:block;margin-bottom:8px;">
      FIND MY NEEDLE →
    </button>
    <a href="#" data-ad-close style="font-size:9px;color:#555;font-family:Arial;text-decoration:none;display:block;">
      No thanks, I'll look manually
    </a>
  </div>
</div>`,

  // Ad 2: Stu's Nursing Improvement Agency
  `<div style="width:370px;max-width:95vw;background:#F4F6FA;border:3px solid #1A237E;position:relative;">
  <div style="background:#1A237E;padding:5px 10px;display:flex;justify-content:space-between;align-items:center;">
    <span style="color:#90CAF9;font-size:9px;letter-spacing:2px;">★ SPONSORED — HOCKEY POOL ★</span>
    <button data-ad-close style="background:#1A237E;border:1px solid #90CAF9;color:#90CAF9;width:19px;height:19px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;padding:0;line-height:1;font-weight:900;">✕</button>
  </div>
  <div style="padding:20px 22px 16px;text-align:center;">
    <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:14px;">
      <svg viewBox="0 0 36 36" style="width:36px;height:36px;flex-shrink:0;" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="18" width="28" height="11" rx="3" fill="#1A237E"/>
        <rect x="8" y="12" width="20" height="8" rx="2" fill="#E8EDF8"/>
        <rect x="8" y="12" width="20" height="8" rx="2" fill="none" stroke="#1A237E" stroke-width="1.5"/>
        <rect x="16" y="9" width="4" height="14" rx="1" fill="#CC0000"/>
        <rect x="10" y="15" width="16" height="3" rx="1" fill="#CC0000"/>
      </svg>
      <div style="text-align:left;">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:15px;font-weight:bold;color:#1A237E;line-height:1.1;letter-spacing:0.5px;">Stu's Nursing</div>
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:15px;font-weight:bold;color:#1A237E;line-height:1.1;letter-spacing:0.5px;">Improvement Agency</div>
        <div style="font-size:8px;color:#5C6BC0;letter-spacing:1.5px;text-transform:uppercase;margin-top:2px;">Healthcare Excellence Solutions™</div>
      </div>
    </div>
    <div style="border-top:1px solid #C5CAE9;margin-bottom:16px;"></div>
    <div style="font-family:Impact,'Arial Black',sans-serif;font-size:38px;color:#CC0000;line-height:1;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">
      Nurses<br>screwing up?
    </div>
    <div style="font-family:Georgia,serif;font-size:17px;color:#1A237E;font-style:italic;margin-bottom:18px;">
      We fix that.
    </div>
    <div style="background:#1A237E;padding:12px 16px;margin-bottom:14px;">
      <div style="font-size:9px;color:#90CAF9;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">Call us today</div>
      <div style="font-family:Impact,'Arial Black',sans-serif;font-size:30px;color:#FFD600;letter-spacing:2px;">1-800-DO BETTER</div>
    </div>
    <div style="display:flex;justify-content:center;gap:12px;margin-bottom:14px;flex-wrap:wrap;">
      <span style="font-size:8px;color:#5C6BC0;border:1px solid #C5CAE9;padding:3px 7px;border-radius:2px;">JCAHO Pending</span>
      <span style="font-size:8px;color:#5C6BC0;border:1px solid #C5CAE9;padding:3px 7px;border-radius:2px;">Est. Last Tuesday</span>
      <span style="font-size:8px;color:#5C6BC0;border:1px solid #C5CAE9;padding:3px 7px;border-radius:2px;">0 Lawsuits*</span>
    </div>
    <button style="background:#CC0000;color:white;border:none;padding:11px 0;font-family:Impact,'Arial Black',sans-serif;font-size:20px;text-transform:uppercase;cursor:pointer;letter-spacing:1px;width:100%;display:block;margin-bottom:8px;">
      GET BETTER NURSES →
    </button>
    <div style="font-size:7.5px;color:#9E9E9E;line-height:1.4;margin-bottom:6px;">
      *as of press time &nbsp;|&nbsp; Results may vary
    </div>
    <a href="#" data-ad-close style="font-size:9px;color:#9E9E9E;font-family:Arial;text-decoration:none;display:block;">
      No thanks, my nurses are fine
    </a>
  </div>
</div>`,

  // Ad 3: Leroy Jenkins Discount Ski Gear
  `<div style="width:370px;max-width:95vw;background:#E3F4FF;border:3px solid #0047AB;position:relative;">
  <div style="background:#0047AB;padding:5px 10px;display:flex;justify-content:space-between;align-items:center;">
    <span style="color:#90CAF9;font-size:9px;letter-spacing:2px;">★ SPONSORED — HOCKEY POOL ★</span>
    <button data-ad-close style="background:#0047AB;border:1px solid #90CAF9;color:#90CAF9;width:19px;height:19px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;padding:0;line-height:1;font-weight:900;">✕</button>
  </div>
  <div style="padding:14px 18px 12px;text-align:center;">
    <div style="font-family:Impact,'Arial Black',sans-serif;font-size:36px;color:#FF4500;line-height:0.9;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;">LEROY JENKINS</div>
    <div style="font-family:Impact,'Arial Black',sans-serif;font-size:20px;color:#0047AB;text-transform:uppercase;letter-spacing:2px;margin-bottom:2px;">Discount Ski Gear</div>
    <div style="font-family:'Times New Roman',Georgia,serif;font-style:italic;font-size:13px;color:#555;margin-bottom:10px;">"Discounts all over the place"</div>
    <div style="border:2px solid #0047AB;border-radius:4px;overflow:hidden;">
      <svg viewBox="0 0 334 195" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;">
        <rect x="0" y="0" width="334" height="195" fill="#B3E5FC"/>
        <rect x="0" y="138" width="334" height="57" fill="#7CB342"/>
        <rect x="0" y="138" width="334" height="6" fill="#8BC34A"/>
        <circle cx="295" cy="22" r="18" fill="#FDD835"/>
        <line x1="295" y1="0" x2="295" y2="6" stroke="#FDD835" stroke-width="2"/>
        <line x1="315" y1="5" x2="311" y2="9" stroke="#FDD835" stroke-width="2"/>
        <line x1="320" y1="22" x2="314" y2="22" stroke="#FDD835" stroke-width="2"/>
        <rect x="205" y="68" width="118" height="72" fill="#FFCC80" stroke="#E0A060" stroke-width="1.5"/>
        <polygon points="198,68 264,28 330,68" fill="#EF8C00"/>
        <rect x="237" y="100" width="22" height="40" rx="2" fill="#8D6E63"/>
        <rect x="212" y="78" width="22" height="18" rx="1" fill="#B3E5FC" stroke="#90A4AE" stroke-width="1"/>
        <line x1="223" y1="78" x2="223" y2="96" stroke="#90A4AE" stroke-width="0.8"/>
        <line x1="212" y1="87" x2="234" y2="87" stroke="#90A4AE" stroke-width="0.8"/>
        <rect x="284" y="79" width="22" height="18" rx="1" fill="#B3E5FC" stroke="#90A4AE" stroke-width="1"/>
        <line x1="295" y1="79" x2="295" y2="97" stroke="#90A4AE" stroke-width="0.8"/>
        <line x1="284" y1="88" x2="306" y2="88" stroke="#90A4AE" stroke-width="0.8"/>
        <rect x="176" y="105" width="9" height="35" fill="#6D4C41"/>
        <ellipse cx="180" cy="90" rx="28" ry="26" fill="#388E3C"/>
        <ellipse cx="165" cy="100" rx="18" ry="16" fill="#43A047"/>
        <ellipse cx="195" cy="98" rx="16" ry="15" fill="#33691E"/>
        <line x1="18" y1="62" x2="175" y2="55" stroke="#888" stroke-width="1.5"/>
        <rect x="28" y="62" width="20" height="18" rx="2" fill="#E53935"/>
        <rect x="22" y="62" width="9" height="12" rx="2" fill="#E53935" transform="rotate(-20,26,62)"/>
        <rect x="46" y="62" width="9" height="12" rx="2" fill="#E53935" transform="rotate(20,50,62)"/>
        <line x1="38" y1="60" x2="38" y2="63" stroke="#888" stroke-width="1"/>
        <rect x="65" y="60" width="10" height="24" rx="1" fill="#1565C0"/>
        <rect x="76" y="60" width="10" height="24" rx="1" fill="#1565C0"/>
        <rect x="64" y="58" width="24" height="5" rx="1" fill="#1A237E"/>
        <line x1="76" y1="56" x2="76" y2="60" stroke="#888" stroke-width="1"/>
        <rect x="105" y="58" width="22" height="20" rx="2" fill="#43A047"/>
        <rect x="98" y="58" width="10" height="13" rx="2" fill="#43A047" transform="rotate(-15,103,58)"/>
        <rect x="124" y="58" width="10" height="13" rx="2" fill="#43A047" transform="rotate(15,129,58)"/>
        <line x1="116" y1="55" x2="116" y2="59" stroke="#888" stroke-width="1"/>
        <rect x="147" y="58" width="20" height="19" rx="2" fill="#F9A825"/>
        <rect x="140" y="57" width="10" height="12" rx="2" fill="#F9A825" transform="rotate(-10,145,57)"/>
        <rect x="165" y="57" width="10" height="12" rx="2" fill="#F9A825" transform="rotate(10,170,57)"/>
        <line x1="157" y1="54" x2="157" y2="59" stroke="#888" stroke-width="1"/>
        <rect x="14" y="95" width="6" height="46" fill="#8D6E63"/>
        <rect x="2" y="83" width="62" height="30" rx="3" fill="white" stroke="#E53935" stroke-width="2" transform="rotate(-4, 33, 98)"/>
        <text x="33" y="96" text-anchor="middle" font-family="Impact" font-size="12" fill="#E53935" transform="rotate(-4, 33, 96)">YARD SALE</text>
        <text x="33" y="108" text-anchor="middle" font-family="Arial" font-size="8" fill="#333" transform="rotate(-4, 33, 108)">ALL MUST GO!</text>
        <rect x="82" y="112" width="152" height="8" rx="2" fill="#795548"/>
        <rect x="82" y="118" width="152" height="3" rx="1" fill="#5D4037"/>
        <rect x="88" y="120" width="5" height="22" rx="1" fill="#6D4C41"/>
        <rect x="225" y="120" width="5" height="22" rx="1" fill="#6D4C41"/>
        <rect x="100" y="120" width="4" height="18" rx="1" fill="#5D4037"/>
        <rect x="212" y="120" width="4" height="18" rx="1" fill="#5D4037"/>
        <line x1="92" y1="138" x2="229" y2="138" stroke="#5D4037" stroke-width="2"/>
        <rect x="88" y="95" width="34" height="18" rx="3" fill="#37474F"/>
        <rect x="91" y="97" width="24" height="12" rx="1" fill="#546E7A"/>
        <rect x="116" y="100" width="4" height="5" rx="1" fill="#90A4AE"/>
        <polygon points="155,96 148,112 164,112" fill="#FFF176"/>
        <rect x="153" y="112" width="6" height="5" rx="1" fill="#BDBDBD"/>
        <ellipse cx="156" cy="117" rx="9" ry="3" fill="#9E9E9E"/>
        <rect x="177" y="105" width="32" height="8" rx="1" fill="#E53935"/>
        <rect x="179" y="98" width="28" height="8" rx="1" fill="#1565C0"/>
        <rect x="181" y="92" width="24" height="7" rx="1" fill="#FDD835"/>
        <ellipse cx="223" cy="106" rx="10" ry="7" fill="#7E57C2"/>
        <rect x="215" y="106" width="16" height="7" rx="2" fill="#7E57C2"/>
        <ellipse cx="223" cy="113" rx="11" ry="4" fill="#5E35B1"/>
        <rect x="18" y="130" width="140" height="8" rx="4" fill="#E53935" transform="rotate(-8, 88, 134)"/>
        <rect x="18" y="130" width="16" height="8" rx="4" fill="#EF9A9A" transform="rotate(-8, 88, 134)"/>
        <rect x="40" y="140" width="135" height="8" rx="4" fill="#1565C0" transform="rotate(12, 107, 144)"/>
        <rect x="40" y="140" width="15" height="8" rx="4" fill="#90CAF9" transform="rotate(12, 107, 144)"/>
        <rect x="245" y="128" width="4" height="90" rx="2" fill="#455A64" transform="rotate(-68, 247, 173)"/>
        <rect x="265" y="132" width="4" height="80" rx="2" fill="#546E7A" transform="rotate(72, 267, 172)"/>
        <rect x="246" y="126" width="40" height="32" rx="2" fill="#BCAAA4" stroke="#A1887F" stroke-width="1"/>
        <line x1="266" y1="126" x2="266" y2="158" stroke="#A1887F" stroke-width="1"/>
        <line x1="246" y1="136" x2="286" y2="136" stroke="#A1887F" stroke-width="1"/>
        <text x="266" y="148" text-anchor="middle" font-family="Arial" font-size="7" fill="#795548">FREE?</text>
        <rect x="148" y="145" width="26" height="20" rx="4" fill="#37474F" transform="rotate(-18, 161, 155)"/>
        <rect x="145" y="160" width="32" height="7" rx="2" fill="#263238" transform="rotate(-18, 161, 163)"/>
        <ellipse cx="310" cy="152" rx="20" ry="16" fill="#FDD835"/>
        <rect x="290" y="160" width="40" height="7" rx="3" fill="#F9A825"/>
        <ellipse cx="310" cy="146" rx="14" ry="8" fill="#1565C0" opacity="0.35"/>
        <rect x="72" y="148" width="34" height="16" rx="2" fill="white" stroke="#E53935" stroke-width="1.2" transform="rotate(10, 89, 156)"/>
        <text x="89" y="155" text-anchor="middle" font-family="Impact" font-size="9" fill="#E53935" transform="rotate(10, 89, 155)">$3 OBO</text>
        <line x1="89" y1="148" x2="91" y2="143" stroke="#888" stroke-width="0.8" transform="rotate(10, 89, 148)"/>
        <rect x="190" y="84" width="30" height="15" rx="2" fill="white" stroke="#E53935" stroke-width="1.2" transform="rotate(-12, 205, 91)"/>
        <text x="205" y="91" text-anchor="middle" font-family="Impact" font-size="8" fill="#E53935" transform="rotate(-12, 205, 91)">25 CENT</text>
        <line x1="205" y1="84" x2="207" y2="79" stroke="#888" stroke-width="0.8" transform="rotate(-12, 205, 84)"/>
        <rect x="250" y="118" width="36" height="14" rx="2" fill="white" stroke="#E53935" stroke-width="1.2" transform="rotate(6, 268, 125)"/>
        <text x="268" y="124" text-anchor="middle" font-family="Impact" font-size="8" fill="#E53935" transform="rotate(6, 268, 124)">TAKE IT!!</text>
      </svg>
    </div>
    <button style="background:#FF4500;color:white;border:none;padding:11px 0;font-family:Impact,'Arial Black',sans-serif;font-size:20px;text-transform:uppercase;cursor:pointer;letter-spacing:1px;width:100%;display:block;margin-top:10px;margin-bottom:8px;">
      CHARGE IN AND SAVE →
    </button>
    <a href="#" data-ad-close style="font-size:9px;color:#9E9E9E;font-family:Arial;text-decoration:none;display:block;">
      No thanks, I have a plan
    </a>
  </div>
</div>`,

  // Ad 4: Brighton Towing Company
  `<div style="width:370px;max-width:95vw;background:#1C1C2E;border:3px solid #FDD835;position:relative;">
  <div style="background:#FDD835;padding:5px 10px;display:flex;justify-content:space-between;align-items:center;">
    <span style="color:#1C1C2E;font-size:9px;letter-spacing:2px;font-weight:bold;">★ SPONSORED — HOCKEY POOL ★</span>
    <button data-ad-close style="background:#FDD835;border:2px solid #1C1C2E;color:#1C1C2E;width:19px;height:19px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;padding:0;line-height:1;font-weight:900;">✕</button>
  </div>
  <div style="padding:16px 20px 14px;text-align:center;">
    <div style="font-family:Impact,'Arial Black',sans-serif;font-size:13px;color:#FDD835;letter-spacing:4px;text-transform:uppercase;margin-bottom:2px;">Brighton</div>
    <div style="font-family:Impact,'Arial Black',sans-serif;font-size:30px;color:white;line-height:0.95;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Towing<br>Company</div>
    <div style="background:#FDD835;padding:6px 12px;display:inline-block;margin-bottom:10px;">
      <span style="font-family:Impact,'Arial Black',sans-serif;font-size:20px;color:#1C1C2E;text-transform:uppercase;letter-spacing:1px;">We've got a snow cat</span>
    </div>
    <div style="border:2px solid #FDD835;border-radius:3px;overflow:hidden;margin-bottom:10px;">
      <svg viewBox="0 0 334 195" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;">
        <rect x="0" y="0" width="334" height="195" fill="#1A2744"/>
        <rect x="0" y="100" width="334" height="95" fill="#1F3060"/>
        <polygon points="0,105 40,60 80,105" fill="#243570"/>
        <polygon points="50,105 100,45 150,105" fill="#1E2E60"/>
        <polygon points="120,105 175,35 230,105" fill="#243570"/>
        <polygon points="200,105 250,55 300,105" fill="#1E2E60"/>
        <polygon points="280,105 320,65 334,105" fill="#243570"/>
        <polygon points="88,56 100,45 112,56 106,58 94,58" fill="white" opacity="0.7"/>
        <polygon points="163,46 175,35 187,46 181,48 169,48" fill="white" opacity="0.7"/>
        <polygon points="238,65 250,55 262,65 256,67 244,67" fill="white" opacity="0.7"/>
        <rect x="0" y="148" width="334" height="47" fill="#D0E8F5"/>
        <ellipse cx="60" cy="148" rx="70" ry="8" fill="#DCF0FF"/>
        <ellipse cx="200" cy="150" rx="90" ry="7" fill="#C8E4F2"/>
        <ellipse cx="310" cy="149" rx="50" ry="7" fill="#DCF0FF"/>
        <polygon points="22,130 30,108 38,130" fill="#1B4332"/>
        <polygon points="19,130 30,102 41,130" fill="#1A3D2E"/>
        <polygon points="38,132 46,112 54,132" fill="#1B4332"/>
        <polygon points="285,132 293,110 301,132" fill="#1B4332"/>
        <polygon points="300,130 308,108 316,130" fill="#1A3D2E"/>
        <polygon points="314,134 322,114 330,134" fill="#1B4332"/>
        <rect x="29" y="130" width="3" height="10" fill="#5D4037"/>
        <rect x="45" y="132" width="3" height="8" fill="#5D4037"/>
        <rect x="292" y="132" width="3" height="8" fill="#5D4037"/>
        <rect x="307" y="130" width="3" height="10" fill="#5D4037"/>
        <rect x="321" y="134" width="3" height="6" fill="#5D4037"/>
        <ellipse cx="290" cy="152" rx="28" ry="7" fill="#2A3E6E" stroke="#FDD835" stroke-width="1" stroke-dasharray="3,2"/>
        <text x="290" y="155" text-anchor="middle" font-family="Arial" font-weight="bold" font-size="9" fill="#FDD835">H</text>
        <g transform="translate(255,52)">
          <ellipse cx="0" cy="0" rx="30" ry="13" fill="#CC0000"/>
          <rect x="28" y="-4" width="35" height="6" rx="2" fill="#B71C1C"/>
          <rect x="60" y="-12" width="3" height="20" rx="1" fill="#888" transform="rotate(15,61,-2)"/>
          <ellipse cx="-14" cy="2" rx="14" ry="10" fill="#42A5F5" opacity="0.6"/>
          <rect x="-42" y="-16" width="84" height="3" rx="1" fill="#546E7A"/>
          <rect x="-38" y="-19" width="76" height="3" rx="1" fill="#546E7A" transform="rotate(40,0,-17)"/>
          <rect x="-20" y="11" width="42" height="3" rx="1" fill="#888"/>
          <rect x="-18" y="8" width="4" height="6" fill="#888"/>
          <rect x="16" y="8" width="4" height="6" fill="#888"/>
          <polygon points="-5,13 5,13 14,38 -14,38" fill="#FFF9C4" opacity="0.25"/>
          <circle cx="-28" cy="0" r="2" fill="#FF5252"/>
          <circle cx="28" cy="0" r="2" fill="#69F0AE"/>
        </g>
        <circle cx="248" cy="110" r="2" fill="white" opacity="0.6"/>
        <circle cx="264" cy="115" r="1.5" fill="white" opacity="0.5"/>
        <circle cx="272" cy="108" r="1.5" fill="white" opacity="0.4"/>
        <circle cx="256" cy="118" r="1" fill="white" opacity="0.5"/>
        <circle cx="280" cy="112" r="2" fill="white" opacity="0.4"/>
        <g transform="translate(198,122) rotate(5)">
          <ellipse cx="2" cy="30" rx="60" ry="18" fill="#C8E4F2"/>
          <path d="M -52,10 L -52,-6 C -51,-16 -46,-22 -38,-23 L -26,-24 L -11,-54 L 50,-54 L 53,-51 L 53,10 Z" fill="#2C3E50"/>
          <path d="M -52,-6 C -51,-16 -46,-22 -38,-23 L -26,-24 L -28,-12 L -50,-10 Z" fill="#364F6B"/>
          <path d="M -26,-24 L -11,-54 L 0,-54 L -16,-24 Z" fill="#42A5F5" opacity="0.55"/>
          <path d="M -26,-24 L -11,-54 L 0,-54 L -16,-24 Z" fill="white" opacity="0.1"/>
          <line x1="0" y1="-54" x2="0" y2="10" stroke="#1C2B3A" stroke-width="1.5"/>
          <rect x="2" y="-50" width="18" height="16" rx="2" fill="#42A5F5" opacity="0.45"/>
          <rect x="24" y="-50" width="13" height="10" rx="1" fill="#42A5F5" opacity="0.3"/>
          <rect x="40" y="-50" width="10" height="10" rx="1" fill="#42A5F5" opacity="0.3"/>
          <line x1="22" y1="-54" x2="22" y2="10" stroke="#1C2B3A" stroke-width="0.8"/>
          <line x1="50" y1="-35" x2="53" y2="-35" stroke="#1C2B3A" stroke-width="0.8"/>
          <rect x="-54" y="-4" width="5" height="14" rx="1" fill="#455A64"/>
          <rect x="-52" y="-18" width="10" height="4" rx="1" fill="#1C2B3A"/>
          <line x1="-51" y1="-17" x2="-43" y2="-17" stroke="#546E7A" stroke-width="0.8"/>
          <line x1="-51" y1="-15" x2="-43" y2="-15" stroke="#546E7A" stroke-width="0.8"/>
          <rect x="-52" y="-10" width="8" height="5" rx="1" fill="#FFF9C4"/>
          <polygon points="-52,-10 -52,-5 -80,-2 -80,-13" fill="#FFF9C4" opacity="0.12"/>
          <rect x="46" y="-10" width="7" height="5" rx="1" fill="#FF5252"/>
          <rect x="46" y="-17" width="7" height="5" rx="1" fill="#FF8A80" opacity="0.6"/>
          <rect x="49" y="2" width="6" height="8" rx="1" fill="#455A64"/>
          <path d="M -11,-55 Q 20,-60 50,-55 L 50,-54 L -11,-54 Z" fill="white" opacity="0.9"/>
          <ellipse cx="-28" cy="16" rx="17" ry="12" fill="#DCF0FF"/>
          <ellipse cx="28" cy="16" rx="17" ry="12" fill="#DCF0FF"/>
          <ellipse cx="-28" cy="18" rx="13" ry="9" fill="#C0D8EC"/>
          <ellipse cx="28" cy="18" rx="13" ry="9" fill="#C0D8EC"/>
          <rect x="8" y="-20" width="8" height="3" rx="1" fill="#546E7A"/>
        </g>
        <line x1="148" y1="148" x2="190" y2="152" stroke="#FDD835" stroke-width="2.5" stroke-dasharray="5,3"/>
        <circle cx="190" cy="152" r="3" fill="#FDD835"/>
        <g transform="translate(90,122)">
          <rect x="-52" y="22" width="104" height="18" rx="6" fill="#333"/>
          <line x1="-40" y1="22" x2="-40" y2="40" stroke="#555" stroke-width="1.5"/>
          <line x1="-25" y1="22" x2="-25" y2="40" stroke="#555" stroke-width="1.5"/>
          <line x1="-10" y1="22" x2="-10" y2="40" stroke="#555" stroke-width="1.5"/>
          <line x1="5" y1="22" x2="5" y2="40" stroke="#555" stroke-width="1.5"/>
          <line x1="20" y1="22" x2="20" y2="40" stroke="#555" stroke-width="1.5"/>
          <line x1="35" y1="22" x2="35" y2="40" stroke="#555" stroke-width="1.5"/>
          <circle cx="-44" cy="31" r="8" fill="#444" stroke="#222" stroke-width="1"/>
          <circle cx="-44" cy="31" r="4" fill="#333"/>
          <circle cx="44" cy="31" r="8" fill="#444" stroke="#222" stroke-width="1"/>
          <circle cx="44" cy="31" r="4" fill="#333"/>
          <rect x="-50" y="-8" width="100" height="32" rx="4" fill="#FDD835"/>
          <rect x="-50" y="16" width="100" height="8" rx="0" fill="#F9A825"/>
          <rect x="-22" y="-28" width="55" height="23" rx="3" fill="#F9A825"/>
          <rect x="-16" y="-24" width="22" height="14" rx="2" fill="#90CAF9" opacity="0.7"/>
          <rect x="10" y="-24" width="18" height="14" rx="2" fill="#90CAF9" opacity="0.7"/>
          <rect x="-46" y="-2" width="22" height="10" rx="1" fill="#FF6F00"/>
          <text x="-35" y="7" text-anchor="middle" font-family="Impact" font-size="8" fill="white">CAT</text>
          <rect x="-60" y="2" width="14" height="20" rx="2" fill="#546E7A"/>
          <rect x="-64" y="5" width="6" height="14" rx="1" fill="#455A64"/>
          <rect x="-50" y="-2" width="6" height="5" rx="1" fill="#FFF9C4"/>
          <rect x="30" y="-42" width="6" height="18" rx="2" fill="#555"/>
          <ellipse cx="33" cy="-44" rx="5" ry="4" fill="#888" opacity="0.5"/>
          <ellipse cx="30" cy="-52" rx="7" ry="5" fill="#999" opacity="0.35"/>
          <ellipse cx="35" cy="-60" rx="9" ry="6" fill="#aaa" opacity="0.2"/>
        </g>
        <ellipse cx="42" cy="162" rx="18" ry="5" fill="white" opacity="0.5"/>
        <ellipse cx="55" cy="168" rx="12" ry="3" fill="white" opacity="0.4"/>
      </svg>
    </div>
    <div style="background:#FDD835;padding:5px 10px;margin-bottom:10px;border-radius:2px;">
      <span style="font-size:8.5px;color:#1C1C2E;font-family:Arial;font-style:italic;">*Disclaimer: Please stay off the helipad. We mean it.</span>
    </div>
    <button style="background:#FDD835;color:#1C1C2E;border:none;padding:11px 0;font-family:Impact,'Arial Black',sans-serif;font-size:20px;text-transform:uppercase;cursor:pointer;letter-spacing:1px;width:100%;display:block;margin-bottom:8px;">
      GET UNSTUCK →
    </button>
    <a href="#" data-ad-close style="font-size:9px;color:#888;font-family:Arial;text-decoration:none;display:block;">No thanks, I'll wait for the thaw</a>
  </div>
</div>`,

  // Ad 5: Dr. Matson — Anesthesia Resident of the Month
  `<div style="width:370px;max-width:95vw;background:#FFFDE7;border:3px solid #1A237E;position:relative;">
  <div style="background:#1A237E;padding:5px 10px;display:flex;justify-content:space-between;align-items:center;">
    <span style="color:#FDD835;font-size:9px;letter-spacing:2px;font-weight:bold;">★ SPONSORED — HOCKEY POOL ★</span>
    <button data-ad-close style="background:#1A237E;border:1px solid #FDD835;color:#FDD835;width:19px;height:19px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;padding:0;line-height:1;font-weight:900;">✕</button>
  </div>
  <div style="padding:18px 20px 14px;text-align:center;border:6px double #1A237E;margin:10px;background:#FFFDE7;">
    <div style="background:#1A237E;height:4px;margin-bottom:12px;position:relative;">
      <div style="background:#FDD835;height:2px;margin:1px 0;"></div>
    </div>
    <div style="font-family:Georgia,'Times New Roman',serif;font-size:9px;color:#5C6BC0;letter-spacing:3px;text-transform:uppercase;margin-bottom:4px;">Baylor Scott & White · Department of Anesthesiology</div>
    <div style="font-family:Impact,'Arial Black',sans-serif;font-size:11px;color:#1A237E;letter-spacing:5px;text-transform:uppercase;margin-bottom:6px;">Congratulations</div>
    <div style="color:#FDD835;font-size:14px;margin-bottom:8px;letter-spacing:4px;">★ ★ ★ ★ ★</div>
    <div style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:34px;color:#1A237E;line-height:1;margin-bottom:4px;">Dr. Matson</div>
    <div style="font-family:Georgia,serif;font-size:10px;color:#555;margin-bottom:8px;letter-spacing:1px;">is proudly recognized as</div>
    <div style="background:#1A237E;padding:8px 12px;margin:0 0 8px;">
      <div style="font-family:Impact,'Arial Black',sans-serif;font-size:17px;color:#FDD835;text-transform:uppercase;letter-spacing:1px;line-height:1.15;">Anesthesia Resident<br>of the Month</div>
    </div>
    <div style="font-family:Georgia,serif;font-style:italic;font-size:13px;color:#333;margin-bottom:4px;">for the</div>
    <div style="font-family:Impact,'Arial Black',sans-serif;font-size:42px;color:#CC0000;line-height:0.9;margin-bottom:2px;">24th</div>
    <div style="font-family:Georgia,serif;font-style:italic;font-size:13px;color:#333;margin-bottom:10px;">consecutive month</div>
    <svg viewBox="0 0 80 80" style="width:60px;height:60px;display:inline-block;margin-bottom:10px;" xmlns="http://www.w3.org/2000/svg">
      <polygon points="40,2 48,14 62,10 62,24 74,30 68,44 74,58 62,60 58,74 44,70 40,78 36,70 22,74 18,60 6,58 12,44 6,30 18,24 18,10 32,14" fill="#FDD835" stroke="#F9A825" stroke-width="1"/>
      <circle cx="40" cy="40" r="22" fill="#1A237E"/>
      <text x="40" y="36" text-anchor="middle" font-family="Impact" font-size="7" fill="#FDD835" letter-spacing="0.5">RESIDENT</text>
      <text x="40" y="45" text-anchor="middle" font-family="Impact" font-size="12" fill="white">of the</text>
      <text x="40" y="55" text-anchor="middle" font-family="Impact" font-size="7" fill="#FDD835" letter-spacing="0.5">MONTH</text>
    </svg>
    <div style="background:#1A237E;height:4px;margin-top:10px;margin-bottom:14px;position:relative;">
      <div style="background:#FDD835;height:2px;margin:1px 0;"></div>
    </div>
    <div style="font-family:Georgia,serif;font-size:8px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">✦ Notes from L&D ✦</div>
    <div style="position:relative;min-height:170px;">
      <div style="position:absolute;left:0px;top:0px;background:#FFF176;border:1px solid #F9A825;padding:7px 9px;width:145px;transform:rotate(-3deg);text-align:left;border-bottom:3px solid #F9A825;">
        <div style="font-family:Georgia,serif;font-style:italic;font-size:9.5px;color:#333;line-height:1.5;">"Actually answers his pager. Every time. We cried."</div>
        <div style="font-family:Georgia,serif;font-style:italic;font-size:8px;color:#777;margin-top:4px;">— Nurse Brittany ♥<br><span style="font-size:7px;">L&D Night Crew</span></div>
      </div>
      <div style="position:absolute;right:0px;top:4px;background:#FCE4EC;border:1px solid #F48FB1;padding:7px 9px;width:145px;transform:rotate(2.5deg);text-align:left;border-bottom:3px solid #F48FB1;">
        <div style="font-family:Georgia,serif;font-style:italic;font-size:9.5px;color:#333;line-height:1.5;">"Best epidurals in the state. Don't tell anyone I said that."</div>
        <div style="font-family:Georgia,serif;font-style:italic;font-size:8px;color:#888;margin-top:4px;">— Nurse McKayla 💕<br><span style="font-size:7px;">Days, OB Floor 3</span></div>
      </div>
      <div style="position:absolute;left:10px;top:100px;background:#E3F2FD;border:1px solid #90CAF9;padding:7px 9px;width:140px;transform:rotate(-1.5deg);text-align:left;border-bottom:3px solid #90CAF9;">
        <div style="font-family:Georgia,serif;font-style:italic;font-size:9.5px;color:#333;line-height:1.5;">"Please never rotate off this floor. We will follow you."</div>
        <div style="font-family:Georgia,serif;font-style:italic;font-size:8px;color:#888;margin-top:4px;">— Signed, Everyone 🌟<br><span style="font-size:7px;">Literally all of us</span></div>
      </div>
      <div style="position:absolute;right:4px;top:106px;background:#E8F5E9;border:1px solid #A5D6A7;padding:7px 9px;width:130px;transform:rotate(3deg);text-align:left;border-bottom:3px solid #A5D6A7;">
        <div style="font-family:Georgia,serif;font-style:italic;font-size:9.5px;color:#333;line-height:1.5;">"He remembered my name. On a Tuesday. Hero."</div>
        <div style="font-family:Georgia,serif;font-style:italic;font-size:8px;color:#888;margin-top:4px;">— Nurse Dana 🍀<br><span style="font-size:7px;">Charge Nurse, OB</span></div>
      </div>
    </div>
  </div>
  <div style="padding:0 10px 12px;text-align:center;">
    <a href="#" data-ad-close style="font-size:9px;color:#666;font-family:Arial;text-decoration:none;display:block;">
      Dismiss · Awards Committee, Dept. of Anesthesiology
    </a>
  </div>
</div>`,

  // Ad 6: Knob Turners Wanted
  `<div style="width:370px;max-width:95vw;background:#F5F0E8;border:3px solid #2C2C2C;">
  <div style="background:#2C2C2C;padding:5px 10px;display:flex;justify-content:space-between;align-items:center;">
    <span style="color:#ccc;font-size:9px;letter-spacing:2px;">★ SPONSORED — HOCKEY POOL ★</span>
    <button data-ad-close style="background:#2C2C2C;border:1px solid #ccc;color:#ccc;width:19px;height:19px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;padding:0;line-height:1;font-weight:900;">✕</button>
  </div>
  <div style="padding:18px 22px 20px;">
    <div style="background:#CC0000;transform:rotate(-2deg);padding:5px 0;margin:0 -8px 18px;box-shadow:2px 3px 0 #880000;">
      <div style="font-family:Impact,'Arial Black',sans-serif;font-size:11px;color:white;letter-spacing:4px;text-align:center;">— HELP WANTED —</div>
    </div>
    <div style="font-family:Impact,'Arial Black',sans-serif;font-size:50px;color:#1A1A1A;text-transform:uppercase;line-height:0.92;text-align:center;margin-bottom:16px;">
      Knob<br>Turners<br>Wanted!
    </div>
    <div style="border:2px dashed #2C2C2C;padding:10px 14px;margin-bottom:18px;transform:rotate(1deg);">
      <div style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:14px;color:#333;text-align:center;line-height:1.5;">
        "Highly trained monkeys<br>also acceptable"
      </div>
    </div>
    <div style="border:2px solid #2C2C2C;padding:10px 14px;text-align:center;margin-bottom:16px;">
      <div style="font-family:Arial,sans-serif;font-size:8.5px;color:#555;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">For employment inquiries</div>
      <div style="font-family:Impact,'Arial Black',sans-serif;font-size:24px;color:#2C2C2C;">Contact Slick Jimmy</div>
      <div style="font-family:Georgia,serif;font-style:italic;font-size:10px;color:#666;margin-top:2px;">for details</div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div style="font-size:7.5px;color:#777;font-style:italic;">*No medical training required</div>
      <a href="#" data-ad-close style="font-size:9px;color:#777;font-family:Arial;text-decoration:none;">Not qualified</a>
    </div>
  </div>
</div>`,

  // Ad 7: Tyson's Hot Dog Delivery
  `<div style="width:370px;max-width:95vw;background:#FFF8F0;border:3px solid #CC2200;position:relative;">
  <div style="background:#CC2200;padding:5px 10px;display:flex;justify-content:space-between;align-items:center;">
    <span style="color:#FFD700;font-size:9px;letter-spacing:2px;font-weight:bold;">★ SPONSORED — HOCKEY POOL ★</span>
    <button data-ad-close style="background:#CC2200;border:1px solid #FFD700;color:#FFD700;width:19px;height:19px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;padding:0;line-height:1;font-weight:900;">✕</button>
  </div>
  <div style="padding:16px 20px 16px;text-align:center;">
    <div style="font-family:Impact,'Arial Black',sans-serif;font-size:13px;color:#CC2200;letter-spacing:4px;text-transform:uppercase;margin-bottom:0px;">Tyson's</div>
    <div style="font-family:Impact,'Arial Black',sans-serif;font-size:38px;color:#1A1A1A;line-height:0.92;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Hot Dog<br>Delivery</div>
    <div style="font-size:18px;letter-spacing:6px;margin-bottom:10px;">🌭🌭🌭</div>
    <div style="border:2px solid #CC2200;border-radius:6px;background:#FFF3E0;overflow:hidden;margin-bottom:12px;">
      <svg viewBox="0 0 334 160" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;">
        <rect x="0" y="0" width="334" height="160" fill="#FFF3E0"/>
        <rect x="0" y="110" width="334" height="50" fill="#FFCCBC"/>
        <line x1="0" y1="110" x2="334" y2="110" stroke="#FF8A65" stroke-width="1.5"/>
        <rect x="0" y="110" width="20" height="20" fill="#FFAB91" opacity="0.4"/>
        <rect x="40" y="110" width="20" height="20" fill="#FFAB91" opacity="0.4"/>
        <rect x="80" y="110" width="20" height="20" fill="#FFAB91" opacity="0.4"/>
        <rect x="120" y="110" width="20" height="20" fill="#FFAB91" opacity="0.4"/>
        <rect x="160" y="110" width="20" height="20" fill="#FFAB91" opacity="0.4"/>
        <rect x="200" y="110" width="20" height="20" fill="#FFAB91" opacity="0.4"/>
        <rect x="240" y="110" width="20" height="20" fill="#FFAB91" opacity="0.4"/>
        <rect x="280" y="110" width="20" height="20" fill="#FFAB91" opacity="0.4"/>
        <rect x="320" y="110" width="20" height="20" fill="#FFAB91" opacity="0.4"/>
        <rect x="20" y="130" width="20" height="20" fill="#FFAB91" opacity="0.4"/>
        <rect x="60" y="130" width="20" height="20" fill="#FFAB91" opacity="0.4"/>
        <rect x="100" y="130" width="20" height="20" fill="#FFAB91" opacity="0.4"/>
        <rect x="140" y="130" width="20" height="20" fill="#FFAB91" opacity="0.4"/>
        <rect x="180" y="130" width="20" height="20" fill="#FFAB91" opacity="0.4"/>
        <rect x="220" y="130" width="20" height="20" fill="#FFAB91" opacity="0.4"/>
        <rect x="260" y="130" width="20" height="20" fill="#FFAB91" opacity="0.4"/>
        <rect x="300" y="130" width="20" height="20" fill="#FFAB91" opacity="0.4"/>
        <line x1="0" y1="55" x2="60" y2="55" stroke="#FFCCBC" stroke-width="3" stroke-linecap="round"/>
        <line x1="0" y1="68" x2="45" y2="68" stroke="#FFCCBC" stroke-width="2" stroke-linecap="round"/>
        <line x1="0" y1="80" x2="55" y2="80" stroke="#FFCCBC" stroke-width="2.5" stroke-linecap="round"/>
        <ellipse cx="185" cy="100" rx="110" ry="22" fill="#D4841A"/>
        <ellipse cx="185" cy="98" rx="110" ry="20" fill="#E8963A"/>
        <ellipse cx="175" cy="102" rx="60" ry="8" fill="#F0A84A" opacity="0.4"/>
        <ellipse cx="185" cy="82" rx="100" ry="18" fill="#8B2500"/>
        <ellipse cx="185" cy="80" rx="100" ry="16" fill="#A83020"/>
        <line x1="130" y1="70" x2="120" y2="92" stroke="#7B1A00" stroke-width="3" stroke-linecap="round" opacity="0.6"/>
        <line x1="155" y1="67" x2="145" y2="93" stroke="#7B1A00" stroke-width="3" stroke-linecap="round" opacity="0.6"/>
        <line x1="180" y1="66" x2="170" y2="94" stroke="#7B1A00" stroke-width="3" stroke-linecap="round" opacity="0.6"/>
        <line x1="205" y1="66" x2="195" y2="94" stroke="#7B1A00" stroke-width="3" stroke-linecap="round" opacity="0.6"/>
        <line x1="230" y1="67" x2="220" y2="93" stroke="#7B1A00" stroke-width="3" stroke-linecap="round" opacity="0.6"/>
        <ellipse cx="85" cy="80" rx="12" ry="16" fill="#922510"/>
        <ellipse cx="285" cy="80" rx="12" ry="16" fill="#922510"/>
        <ellipse cx="185" cy="72" rx="70" ry="6" fill="#C83828" opacity="0.4"/>
        <ellipse cx="185" cy="64" rx="110" ry="26" fill="#E8963A"/>
        <ellipse cx="185" cy="60" rx="108" ry="24" fill="#F0A840"/>
        <ellipse cx="170" cy="52" rx="60" ry="10" fill="#F8C060" opacity="0.5"/>
        <ellipse cx="155" cy="50" rx="4" ry="2.5" fill="#D4841A" transform="rotate(-20,155,50)"/>
        <ellipse cx="175" cy="44" rx="4" ry="2.5" fill="#D4841A" transform="rotate(10,175,44)"/>
        <ellipse cx="198" cy="47" rx="4" ry="2.5" fill="#D4841A" transform="rotate(-10,198,47)"/>
        <ellipse cx="218" cy="53" rx="4" ry="2.5" fill="#D4841A" transform="rotate(20,218,53)"/>
        <path d="M 85 75 Q 105 65 125 75 Q 145 85 165 75 Q 185 65 205 75 Q 225 85 245 75 Q 260 68 278 75" fill="none" stroke="#FFD700" stroke-width="5" stroke-linecap="round"/>
        <path d="M 90 83 Q 115 76 140 83 Q 165 90 190 83 Q 215 76 240 83 Q 258 87 275 83" fill="none" stroke="#FFD700" stroke-width="4" stroke-linecap="round" opacity="0.7"/>
        <path d="M 100 78 Q 130 70 160 78 Q 190 86 220 78 Q 248 70 270 78" fill="none" stroke="#F9A800" stroke-width="3" stroke-linecap="round" opacity="0.5"/>
        <path d="M 100 82 Q 125 76 150 82 Q 175 88 200 82 Q 225 76 250 82 Q 265 85 278 82" fill="none" stroke="#CC2200" stroke-width="3" stroke-linecap="round"/>
        <path d="M 150 38 Q 145 30 150 22 Q 155 14 150 6" fill="none" stroke="#FFCCBC" stroke-width="2" stroke-linecap="round"/>
        <path d="M 185 34 Q 180 26 185 18 Q 190 10 185 2" fill="none" stroke="#FFCCBC" stroke-width="2" stroke-linecap="round"/>
        <path d="M 220 38 Q 215 30 220 22 Q 225 14 220 6" fill="none" stroke="#FFCCBC" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </div>
    <div style="font-family:Impact,'Arial Black',sans-serif;font-size:26px;color:#CC2200;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">We'll Come To You!</div>
    <div style="font-family:Georgia,serif;font-style:italic;font-size:12px;color:#888;margin-bottom:14px;">Hot, fresh, delivered to your exact GPS coordinates</div>
    <div style="display:flex;justify-content:center;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
      <span style="font-size:8px;color:#CC2200;border:1px solid #CC2200;padding:3px 7px;border-radius:2px;background:white;">Mustard Mandatory</span>
      <span style="font-size:8px;color:#CC2200;border:1px solid #CC2200;padding:3px 7px;border-radius:2px;background:white;">Extra Mustard</span>
      <span style="font-size:8px;color:#CC2200;border:1px solid #CC2200;padding:3px 7px;border-radius:2px;background:white;">Est. Recently</span>
    </div>
    <button style="background:#CC2200;color:#FFD700;border:none;padding:11px 0;font-family:Impact,'Arial Black',sans-serif;font-size:22px;text-transform:uppercase;cursor:pointer;letter-spacing:1px;width:100%;display:block;margin-bottom:8px;">
      ORDER NOW →
    </button>
    <a href="#" data-ad-close style="font-size:9px;color:#aaa;font-family:Arial;text-decoration:none;display:block;">
      No thanks, I'm not hungry
    </a>
  </div>
</div>`,

  // Ad 8: Esteban's Custom Scrub Bottoms
  `<div style="width:370px;max-width:95vw;background:#F0F4F0;border:3px solid #2E7D32;position:relative;">
  <div style="background:#2E7D32;padding:5px 10px;display:flex;justify-content:space-between;align-items:center;">
    <span style="color:#A5D6A7;font-size:9px;letter-spacing:2px;font-weight:bold;">★ SPONSORED — HOCKEY POOL ★</span>
    <button data-ad-close style="background:#2E7D32;border:1px solid #A5D6A7;color:#A5D6A7;width:19px;height:19px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;padding:0;line-height:1;font-weight:900;">✕</button>
  </div>
  <div style="padding:16px 20px 16px;text-align:center;">
    <div style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:32px;color:#2E7D32;line-height:1;margin-bottom:0px;">Esteban's</div>
    <div style="font-family:Impact,'Arial Black',sans-serif;font-size:17px;color:#1A1A1A;letter-spacing:3px;text-transform:uppercase;margin-bottom:10px;">Custom Scrub Bottoms</div>
    <div style="border:2px solid #2E7D32;border-radius:4px;overflow:hidden;background:#E8F5E9;margin-bottom:12px;">
      <svg viewBox="0 0 334 175" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;">
        <rect x="0" y="0" width="334" height="175" fill="#E8F5E9"/>
        <rect x="0" y="135" width="334" height="40" fill="#C8E6C9"/>
        <line x1="0" y1="135" x2="334" y2="135" stroke="#A5D6A7" stroke-width="1.5"/>
        <rect x="12" y="10" width="55" height="120" rx="3" fill="none" stroke="#A5D6A7" stroke-width="2"/>
        <rect x="15" y="13" width="49" height="114" rx="2" fill="#C8E6C9" opacity="0.4"/>
        <line x1="22" y1="20" x2="22" y2="118" stroke="white" stroke-width="1" opacity="0.5"/>
        <rect x="267" y="10" width="55" height="120" rx="3" fill="none" stroke="#A5D6A7" stroke-width="2"/>
        <rect x="270" y="13" width="49" height="114" rx="2" fill="#C8E6C9" opacity="0.4"/>
        <line x1="277" y1="20" x2="277" y2="118" stroke="white" stroke-width="1" opacity="0.5"/>
        <rect x="107" y="28" width="120" height="18" rx="3" fill="#1B5E20"/>
        <path d="M 155 28 L 150 20 L 145 22" fill="none" stroke="#81C784" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M 179 28 L 184 20 L 189 22" fill="none" stroke="#81C784" stroke-width="1.5" stroke-linecap="round"/>
        <ellipse cx="155" cy="20" rx="5" ry="3" fill="#A5D6A7"/>
        <ellipse cx="184" cy="20" rx="5" ry="3" fill="#A5D6A7"/>
        <path d="M 107 44 Q 107 130 120 138 L 167 138 L 167 85 L 167 85 L 167 138 L 214 138 Q 227 130 227 44 Z" fill="#388E3C"/>
        <line x1="167" y1="55" x2="167" y2="138" stroke="#2E7D32" stroke-width="1.5" stroke-dasharray="4,3"/>
        <rect x="118" y="55" width="36" height="28" rx="2" fill="#2E7D32" stroke="#1B5E20" stroke-width="1"/>
        <line x1="118" y1="66" x2="154" y2="66" stroke="#1B5E20" stroke-width="0.8"/>
        <path d="M 118 55 Q 136 50 154 55" fill="none" stroke="#1B5E20" stroke-width="1"/>
        <rect x="180" y="55" width="36" height="28" rx="2" fill="#2E7D32" stroke="#1B5E20" stroke-width="1"/>
        <line x1="180" y1="66" x2="216" y2="66" stroke="#1B5E20" stroke-width="0.8"/>
        <path d="M 180 55 Q 198 50 216 55" fill="none" stroke="#1B5E20" stroke-width="1"/>
        <text x="136" y="77" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-size="7" fill="#A5D6A7">Est.</text>
        <path d="M 107 44 L 107 130 Q 108 138 120 138 L 167 138 L 167 44 Z" fill="#43A047"/>
        <path d="M 227 44 L 227 130 Q 226 138 214 138 L 167 138 L 167 44 Z" fill="#43A047"/>
        <rect x="107" y="130" width="60" height="8" rx="2" fill="#2E7D32"/>
        <rect x="167" y="130" width="60" height="8" rx="2" fill="#2E7D32"/>
        <ellipse cx="140" cy="80" rx="22" ry="26" fill="#4CAF50" opacity="0.25"/>
        <ellipse cx="194" cy="80" rx="22" ry="26" fill="#4CAF50" opacity="0.25"/>
        <text x="88" y="75" font-size="14" fill="#FFD700" opacity="0.8">✦</text>
        <text x="244" y="68" font-size="12" fill="#FFD700" opacity="0.8">✦</text>
        <text x="78" y="105" font-size="10" fill="#FFD700" opacity="0.6">✦</text>
        <text x="252" y="100" font-size="10" fill="#FFD700" opacity="0.6">✦</text>
        <rect x="145" y="31" width="44" height="11" rx="2" fill="#FFD700"/>
        <text x="167" y="39" text-anchor="middle" font-family="Impact" font-size="7" fill="#2E7D32" letter-spacing="0.5">CUSTOM FIT</text>
      </svg>
    </div>
    <div style="font-family:Impact,'Arial Black',sans-serif;font-size:26px;color:#2E7D32;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">We've Got Your Back.</div>
    <div style="font-family:Georgia,serif;font-style:italic;font-size:14px;color:#CC2200;margin-bottom:12px;">Literally.</div>
    <div style="display:flex;justify-content:center;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
      <span style="font-size:8px;color:#2E7D32;border:1px solid #2E7D32;padding:3px 7px;border-radius:2px;background:white;">Custom Tailored</span>
      <span style="font-size:8px;color:#2E7D32;border:1px solid #2E7D32;padding:3px 7px;border-radius:2px;background:white;">All Sizes Welcome</span>
      <span style="font-size:8px;color:#2E7D32;border:1px solid #2E7D32;padding:3px 7px;border-radius:2px;background:white;">Deep Pockets</span>
    </div>
    <button style="background:#2E7D32;color:white;border:none;padding:11px 0;font-family:Impact,'Arial Black',sans-serif;font-size:20px;text-transform:uppercase;cursor:pointer;letter-spacing:1px;width:100%;display:block;margin-bottom:8px;">
      GET FITTED →
    </button>
    <div style="font-size:7.5px;color:#aaa;font-style:italic;margin-bottom:6px;">*Esteban measures twice, cuts once</div>
    <a href="#" data-ad-close style="font-size:9px;color:#aaa;font-family:Arial;text-decoration:none;display:block;">
      No thanks, my scrubs fit fine
    </a>
  </div>
</div>`,

  // Ad 9: Dillon's White Bread
  `<div style="width:370px;max-width:95vw;background:white;border:3px solid #E53935;position:relative;">
  <div style="background:#E53935;padding:5px 10px;display:flex;justify-content:space-between;align-items:center;">
    <span style="color:white;font-size:9px;letter-spacing:2px;font-weight:bold;">★ SPONSORED — HOCKEY POOL ★</span>
    <button data-ad-close style="background:#E53935;border:1px solid white;color:white;width:19px;height:19px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;padding:0;line-height:1;font-weight:900;">✕</button>
  </div>
  <div style="background:#1565C0;padding:4px 10px;display:flex;gap:6px;align-items:center;justify-content:center;">
    <div style="width:12px;height:12px;border-radius:50%;background:#E53935;"></div>
    <div style="width:16px;height:16px;border-radius:50%;background:#FFD700;"></div>
    <div style="width:10px;height:10px;border-radius:50%;background:#E53935;"></div>
    <div style="width:14px;height:14px;border-radius:50%;background:#FFD700;"></div>
    <div style="width:11px;height:11px;border-radius:50%;background:#E53935;"></div>
    <div style="width:16px;height:16px;border-radius:50%;background:#FFD700;"></div>
    <div style="width:12px;height:12px;border-radius:50%;background:#E53935;"></div>
    <div style="width:14px;height:14px;border-radius:50%;background:#FFD700;"></div>
    <div style="width:10px;height:10px;border-radius:50%;background:#E53935;"></div>
    <div style="width:15px;height:15px;border-radius:50%;background:#FFD700;"></div>
    <div style="width:11px;height:11px;border-radius:50%;background:#E53935;"></div>
  </div>
  <div style="padding:16px 20px 16px;text-align:center;">
    <div style="font-family:Impact,'Arial Black',sans-serif;font-size:44px;color:#1565C0;text-transform:uppercase;line-height:0.9;letter-spacing:2px;margin-bottom:2px;">Dillon's</div>
    <div style="font-family:Impact,'Arial Black',sans-serif;font-size:22px;color:#E53935;text-transform:uppercase;letter-spacing:4px;margin-bottom:12px;">White Bread</div>
    <div style="border:2px solid #E0E0E0;border-radius:4px;background:#FAFAFA;overflow:hidden;margin-bottom:12px;">
      <svg viewBox="0 0 334 155" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;">
        <rect x="0" y="0" width="334" height="155" fill="#FAFAFA"/>
        <rect x="0" y="115" width="334" height="40" fill="#F0F0F0"/>
        <line x1="0" y1="115" x2="334" y2="115" stroke="#E0E0E0" stroke-width="1.5"/>
        <ellipse cx="167" cy="125" rx="105" ry="10" fill="#E0E0E0"/>
        <rect x="55" y="35" width="224" height="88" rx="6" fill="#F5F5F5" stroke="#E0E0E0" stroke-width="1"/>
        <ellipse cx="62" cy="79" rx="8" ry="44" fill="#EEEEEE" stroke="#E0E0E0" stroke-width="1"/>
        <ellipse cx="272" cy="79" rx="8" ry="44" fill="#EEEEEE" stroke="#E0E0E0" stroke-width="1"/>
        <rect x="80" y="42" width="18" height="74" rx="3" fill="#F5DEB3" opacity="0.5"/>
        <rect x="100" y="40" width="16" height="78" rx="3" fill="#F5DEB3" opacity="0.6"/>
        <rect x="118" y="39" width="16" height="80" rx="3" fill="#F5E8C0" opacity="0.7"/>
        <rect x="136" y="38" width="16" height="82" rx="4" fill="#F5E8C0" opacity="0.8"/>
        <rect x="154" y="38" width="16" height="82" rx="4" fill="#FAF0D0" opacity="0.9"/>
        <rect x="172" y="38" width="16" height="82" rx="4" fill="#FAF0D0"/>
        <rect x="190" y="38" width="16" height="82" rx="4" fill="#F5E8C0" opacity="0.9"/>
        <rect x="208" y="39" width="16" height="80" rx="3" fill="#F5E8C0" opacity="0.8"/>
        <rect x="226" y="40" width="16" height="78" rx="3" fill="#F5DEB3" opacity="0.7"/>
        <rect x="118" y="52" width="98" height="54" rx="4" fill="white" stroke="#E53935" stroke-width="1.5"/>
        <circle cx="124" cy="58" r="3" fill="#E53935"/>
        <circle cx="210" cy="58" r="3" fill="#E53935"/>
        <circle cx="124" cy="100" r="3" fill="#1565C0"/>
        <circle cx="210" cy="100" r="3" fill="#1565C0"/>
        <text x="167" y="72" text-anchor="middle" font-family="Impact,'Arial Black'" font-size="11" fill="#1565C0" letter-spacing="1">DILLON'S</text>
        <text x="167" y="83" text-anchor="middle" font-family="Impact,'Arial Black'" font-size="8" fill="#E53935" letter-spacing="2">WHITE</text>
        <text x="167" y="94" text-anchor="middle" font-family="Impact,'Arial Black'" font-size="8" fill="#E53935" letter-spacing="2">BREAD</text>
        <rect x="260" y="72" width="14" height="14" rx="3" fill="#FFD700" stroke="#F9A825" stroke-width="1" transform="rotate(15,267,79)"/>
        <rect x="78" y="35" width="22" height="84" rx="5" fill="#FFF8E7" stroke="#DEB887" stroke-width="1.5"/>
        <rect x="78" y="35" width="22" height="8" rx="3" fill="#DEB887"/>
        <rect x="78" y="111" width="22" height="8" rx="3" fill="#DEB887"/>
        <rect x="78" y="35" width="5" height="84" rx="3" fill="#DEB887"/>
        <rect x="95" y="35" width="5" height="84" rx="3" fill="#DEB887"/>
        <rect x="84" y="44" width="12" height="66" rx="2" fill="#FFFDF5"/>
        <ellipse cx="88" cy="55" rx="3" ry="2" fill="#F5F0E0" opacity="0.8"/>
        <ellipse cx="93" cy="70" rx="2" ry="3" fill="#F5F0E0" opacity="0.8"/>
        <ellipse cx="87" cy="85" rx="3" ry="2" fill="#F5F0E0" opacity="0.8"/>
        <ellipse cx="93" cy="98" rx="2" ry="2" fill="#F5F0E0" opacity="0.8"/>
        <text x="52" y="58" font-size="10" fill="#FFD700">✦</text>
        <text x="48" y="80" font-size="8" fill="#FFD700" opacity="0.7">✦</text>
      </svg>
    </div>
    <div style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:17px;color:#333;margin-bottom:6px;line-height:1.3;">
      "It's bread."
    </div>
    <div style="font-family:Georgia,serif;font-style:italic;font-size:11px;color:#999;margin-bottom:14px;">White bread. From Dillon.</div>
    <div style="display:flex;justify-content:center;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
      <span style="font-size:8px;color:#1565C0;border:1px solid #1565C0;padding:3px 7px;border-radius:2px;">Sliced</span>
      <span style="font-size:8px;color:#1565C0;border:1px solid #1565C0;padding:3px 7px;border-radius:2px;">White</span>
      <span style="font-size:8px;color:#1565C0;border:1px solid #1565C0;padding:3px 7px;border-radius:2px;">Bread</span>
    </div>
    <button style="background:#E53935;color:white;border:none;padding:11px 0;font-family:Impact,'Arial Black',sans-serif;font-size:20px;text-transform:uppercase;cursor:pointer;letter-spacing:1px;width:100%;display:block;margin-bottom:8px;">
      BUY BREAD →
    </button>
    <div style="font-size:7.5px;color:#bbb;font-style:italic;margin-bottom:6px;">*Contains bread &nbsp;|&nbsp; May contain more bread</div>
    <a href="#" data-ad-close style="font-size:9px;color:#bbb;font-family:Arial;text-decoration:none;display:block;">
      No thanks, I prefer sourdough
    </a>
  </div>
</div>`,
];

export default function AdOverlay({
  storageKey = "hp_ad_visits",
}: {
  storageKey?: string;
}) {
  const [open, setOpen] = useState(false);
  const [adIndex, setAdIndex] = useState(0);

  useEffect(() => {
    // Only allow one ad per browser session across all pages
    if (sessionStorage.getItem("hp_ad_shown")) return;

    const raw = localStorage.getItem(storageKey);
    const prev = typeof raw === "string" ? parseInt(raw, 10) || 0 : 0;
    const next = prev + 1;
    localStorage.setItem(storageKey, String(next));

    if (next % 2 === 0) {
      sessionStorage.setItem("hp_ad_shown", "1");
      setAdIndex(Math.floor(Math.random() * ADS.length));
      setOpen(true);
    }
  }, []);

  if (!open) return null;

  const close = () => setOpen(false);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <div
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (
            target.hasAttribute("data-ad-close") ||
            target.closest("[data-ad-close]")
          ) {
            e.preventDefault();
            close();
          }
        }}
        dangerouslySetInnerHTML={{ __html: ADS[adIndex] }}
      />
    </div>
  );
}
