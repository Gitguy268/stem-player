const row = (a: string, b: string) => `<tr><td>${a}</td><td>${b}</td></tr>`;

export const HELP_V1 = `<h3>Handheld</h3><table>
${row('Centre', 'Play or pause. Clears speed, loop and effects first if set')}
${row('Slide a groove', 'Stem volume')}
${row('Hold a groove end', 'Isolate. Works with several fingers')}
${row('Hold centre', 'Instant loop while playing. Press power to lock it')}
${row('Power', 'Loop and speed menu. Hold to turn off')}
${row('Power, then hold centre', 'Lock. Press power to unlock')}
${row('+ or − in the loop menu', 'Effects menu. Up and down pick one of 8, left and right set the amount')}
${row('Prev, next', 'Track. Hold to jump, or play fast when paused')}
${row('Prev + next, held', 'Next album')}
${row('+ held', 'Record up to 60 s')}
${row('+ and − held', 'Pair: pick an audio output')}
${row('Hold centre while powering on', 'Storage mode: opens the library')}
</table>`;

export const HELP_V2 = `<h3>Speaker</h3><table>
${row('Centre', 'Play or pause. Hold for minimal mode')}
${row('Tap a point', 'Swap in that stem from the mix song')}
${row('Hold a point', 'Isolate. Works with several fingers')}
${row('Hold a point + next', 'Change the mix song')}
${row('Power', 'Loop menu, then speed menu, then back. Hold to turn off')}
${row('Loop menu', 'Tap locks a loop, hold slips. Left 2, bottom 1, right ½, top ¼ beat')}
${row('Speed menu', 'Left and right set speed, top and bottom pitch, centre resets. Hold right to scratch')}
${row('Left + right, held', 'Record')}
${row('+ and power, held', 'Storage mode: opens the library')}
${row('BT', 'Tap link, hold pair')}
${row('FM', 'Add and split a song')}
${row('Aux jack', 'Click to play your microphone or line input through it')}
${row('USB-C', 'Click to cycle charging, charging a phone, off')}
${row('+ and FM, 10 s', 'Factory reset')}
</table>`;

export const HELP_COMMON = `<h3>Mouse and keyboard</h3><table>
${row('Drag empty surface', 'Turn the device')}
${row('Right click a control', 'Keeps it held, so one mouse can play two-button moves')}
${row('Space', 'Centre')}
${row('P', 'Power')}
${row('= or −', 'Volume')}
${row('[ or ]', 'Previous, next')}
${row('Arrows', 'Stems. Shift + arrow on the handheld isolates')}
${row('B, F', 'Speaker Bluetooth, FM')}
${row('L', 'Library')}
</table>`;
