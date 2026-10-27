# Third-party notices

Exo Browser's own code is proprietary (see [LICENSE](LICENSE)). The installer also carries the components below, each under its own license. Nothing here changes those licenses; where a license needs its full text, the text ships next to the component or is included here.

## Exo Shield (a separate program)

Exo Shield is Exo Browser's built-in blocker, installed in `app\extensions\exo-shield`. It is free software under the GNU General Public License version 3; its full text is in `LICENSE.txt` there, and what was changed is in `NOTICE.txt`. Its source, with the script that builds it: <https://github.com/UhhErix/exo-shield>.

| Component | Version | License | Source |
| --- | --- | --- | --- |
| uBlock Origin Lite, by Raymond Hill and contributors | 2026.1021.1354 | GPL-3.0 | <https://github.com/uBlockOrigin/uBOL-home> |
| TTV LOL PRO, by Younes Aassila and contributors | 2.6.2 | GPL-3.0 | <https://github.com/younesaassila/ttv-lol-pro> |
| HaGeZi's DNS blocklists (Multi PRO) | October 22, 2026 | GPL-3.0 | <https://github.com/hagezi/dns-blocklists> |

uBlock Origin Lite carries the filter lists it was built with (EasyList, EasyPrivacy, AdGuard, uBlock filters and others), each under its own license, listed in its `rulesets` folder.

## Built into Exo Browser

| Component | License | Source |
| --- | --- | --- |
| Microsoft Edge WebView2 SDK (its static loader) | BSD-3-Clause, below | <https://www.nuget.org/packages/Microsoft.Web.WebView2> |
| Argon2 reference implementation, by Daniel Dinu, Dmitry Khovratovich, Jean-Philippe Aumasson and Samuel Neves | CC0 1.0 (or Apache-2.0) | <https://github.com/P-H-C/phc-winner-argon2> |
| React and React DOM, by Meta Platforms, Inc. and affiliates | MIT | <https://github.com/facebook/react> |
| clsx, by Luke Edwards | MIT | <https://github.com/lukeed/clsx> |
| Tabler Icons, by Paweł Kuna | MIT | <https://github.com/tabler/tabler-icons> |
| Inter, by Rasmus Andersson | SIL Open Font License 1.1 (`ui\fonts\LICENSE-Inter.txt`) | <https://github.com/rsms/inter> |

The installer is made with NSIS (zlib/libpng license, <https://nsis.sourceforge.io>).

## Microsoft Edge WebView2

Exo Browser runs on the Microsoft Edge WebView2 Runtime, which is part of Windows and is not distributed with Exo Browser. It is Microsoft's, under Microsoft's terms. Setup installs it from Microsoft when a PC doesn't have it.

The WebView2 SDK's loader, built into `ExoBrowser.exe` and `ExoSetup.exe`, is under this license:

```text
Copyright (C) Microsoft Corporation. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * The name of Microsoft Corporation, or the names of its contributors
may not be used to endorse or promote products derived from this
software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## The MIT License

React and React DOM (Copyright (c) Meta Platforms, Inc. and affiliates), clsx (Copyright (c) Luke Edwards) and Tabler Icons (Copyright (c) Paweł Kuna) are under the MIT License:

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
