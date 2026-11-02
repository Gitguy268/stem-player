# Parity with the real devices

Every behaviour, where it came from, and how sure that is.

**Sourced** means an official or community source states it, or it was measured on official media. **Reconstructed** means no source says, so this is a best guess, which may be wrong.

Sources: **M** official manual scans, **I** official Stem2 instruction images, **V** how-to video captions, **R** rotation videos, **P** product posters, **C** community manual (Gare), **Y** yeezymafia guide.

## Handheld (v1)

| Thing                                                                                    | Status                                                                                                                    | Source  |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------- |
| Stems: top vocals, right other, bottom drums, left bass                                  | Sourced                                                                                                                   | M, C    |
| File numbers: 1 other, 2 vocals, 3 bass, 4 drums                                         | Sourced                                                                                                                   | C       |
| LED radii 0.33, 0.46, 0.59, 0.715 of the radius                                          | Measured, within 1 % of diameter                                                                                          | P       |
| Thickness 0.52 of the diameter                                                           | Measured                                                                                                                  | R       |
| Power pad on top, `+`/`−` pill, two-dot prev/next pill, grille, jack and USB-C positions | Measured                                                                                                                  | R, V    |
| Which end of each pill is which                                                          | Reconstructed from the marks on it                                                                                        | R       |
| Timings and speeds from `config.txt`                                                     | Sourced                                                                                                                   | C       |
| Isolation, lock, instant loop, album cycle, record, pair                                 | Sourced                                                                                                                   | M, C, Y |
| Loop and speed menu layout                                                               | Sourced                                                                                                                   | M       |
| Exact hold durations                                                                     | Reconstructed                                                                                                             | None    |
| Names of the 8 effects                                                                   | **Reconstructed**. No source names them. Reverb, echo, low-pass, high-pass, flanger, tremolo, crush, phaser are stand-ins | None    |
| Power off by a 2 s hold                                                                  | Reconstructed                                                                                                             | None    |
| Back of the device left blank                                                            | Deliberate: the real one carries maker marks                                                                              | R       |

## Speaker (v2, Stem2)

| Thing                                                                             | Status                                                              | Source |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------ |
| 5 touch points at the centre and compass points, radius 0.79                      | Measured                                                            | R, V   |
| Vocals top, melody right, drums bottom, bass left                                 | Sourced                                                             | V      |
| Grilles at the 4 compass points of the rim, port panel lower left, thickness 0.42 | Measured                                                            | R      |
| Which rim button group is at which diagonal                                       | Reconstructed from R and I                                          | R, I   |
| Size of 22 cm                                                                     | Reconstructed, from hands in the video                              | V      |
| Tap swaps a stem, tapping again reverts                                           | Sourced                                                             | V      |
| Hold isolates, several at once                                                    | Sourced                                                             | V      |
| Stem + skip changes the mix song                                                  | Sourced                                                             | V      |
| Power opens the loop menu, again the speed menu                                   | Sourced                                                             | V      |
| Left 2, bottom 1, right ½, top ¼ beat                                             | Sourced                                                             | V      |
| Touch for slip loop, press for standard loop                                      | Sourced, with hold and tap standing in for touch and press          | V      |
| Speed right and left, pitch top and bottom, centre resets                         | Top and bottom sourced; left and right reconstructed from the video | V      |
| Record scratch on the right point                                                 | Reconstructed: the caption is sourced, the exact gesture is not     | V      |
| Skip, loop and auto transitions, stems fading in stages                           | Stages sourced; timing reconstructed                                | V      |
| Minimal mode from holding the centre                                              | Sourced                                                             | V      |
| Mute on click as an optional setting                                              | Sourced, as a double tap here                                       | V      |
| Recording gesture: two hands on the side points                                   | **Reconstructed** from the video framing                            | V      |
| Red recording indicator, pink storage indicator, `+` + power for storage          | Sourced                                                             | V      |
| `+` + FM for 10 s factory reset                                                   | Sourced                                                             | I      |
| Red flashing at low battery, reverse charging                                     | Sourced, with a simulated battery                                   | V      |

## Cannot be exact in a browser

| Real device                                  | Here                                                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Haptics                                      | `navigator.vibrate` where the device has it                                                                       |
| Bluetooth                                    | The LED behaviour, plus the browser's audio output picker where one exists. Chromium and Safari currently lack it |
| Touch against physical press                 | Tap, hold and double tap                                                                                          |
| Stem FM, sessions, Wi-Fi, song links         | Local library and local split only. A "session" is the current album                                              |
| Battery and charging                         | Simulated                                                                                                         |
| Fingers on two controls at once with a mouse | Right click keeps a control held                                                                                  |

## Measured on 2026-11-01

| Check                                    | Result                                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Tan, clear, bao, speaker against posters | Worst LED error 0.3, 1.0, 0.8, 1.5 % of diameter. Face colour within 15 of 255 per channel            |
| Four stems through loop wraps            | Opposite phases cancel to zero                                                                        |
| 125 % speed                              | A click at 2 s arrives at 1.600 s after the 20 ms start offset                                        |
| Isolation                                | Others below -300 dB                                                                                  |
| Demucs on a 12 s synthetic mix           | Correlation with the true stem: vocals 0.95, other 0.85, drums 0.99, bass 1.00, the same on all paths |
| Demucs speed on an Apple GPU Mac         | 5 to 7 s on the GPU, 11 s on the processor, about 25 s on one thread without isolation headers        |
