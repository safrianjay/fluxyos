(function () {
    const DAY_MS = 86400000;

    function getDayKey(date = new Date()) {
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0')
        ].join('-');
    }

    function parseDayKey(dayKey) {
        const [year, month, day] = dayKey.split('-').map(Number);
        return new Date(year, month - 1, day);
    }

    function addDays(dayKey, delta) {
        const date = parseDayKey(dayKey);
        date.setDate(date.getDate() + delta);
        return getDayKey(date);
    }

    function addMonths(dayKey, delta) {
        const [year, month] = dayKey.split('-').map(Number);
        return getDayKey(new Date(year, month - 1 + delta, 1));
    }

    function getMonthStartKey(date = new Date()) {
        return getDayKey(new Date(date.getFullYear(), date.getMonth(), 1));
    }

    function getMonthEndKey(date = new Date()) {
        return getDayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0));
    }

    function formatMonthLabel(dayKey) {
        return parseDayKey(dayKey).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }

    function formatDayLabel(dayKey) {
        return parseDayKey(dayKey).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    }

    function formatRangeLabel(startKey, endKey) {
        const isFullMonth = startKey === getMonthStartKey(parseDayKey(startKey))
            && endKey === getMonthEndKey(parseDayKey(startKey));
        if (isFullMonth) return formatMonthLabel(startKey);
        if (startKey === endKey) return formatDayLabel(startKey);
        return `${formatDayLabel(startKey)} - ${formatDayLabel(endKey)}`;
    }

    function mountDateRangePicker(target, options = {}) {
        const host = typeof target === 'string' ? document.querySelector(target) : target;
        if (!host) return null;

        const maxDate = options.maxDate || getDayKey();
        const defaultStart = options.defaultStart || getMonthStartKey();
        const defaultEnd = options.defaultEnd || getMonthEndKey();
        const isSingleDate = options.mode === 'single' || options.singleDate === true;
        let rangeStart = options.start || defaultStart;
        let rangeEnd = isSingleDate ? rangeStart : (options.end || defaultEnd);
        let draftStart = rangeStart;
        let draftEnd = rangeEnd;
        let calendarBaseMonth = getMonthStartKey(parseDayKey(rangeStart));

        host.innerHTML = `
            <div class="relative">
                <div class="flex items-center bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden" aria-label="Date range filter">
                    <button data-drp-prev type="button" class="${isSingleDate ? 'hidden' : 'h-9 w-9 inline-flex'} items-center justify-center text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-all active:scale-95" aria-label="Previous period">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.25" d="m15 18-6-6 6-6"></path></svg>
                    </button>
                    <button data-drp-trigger type="button" class="${isSingleDate ? 'h-10 w-full min-w-[160px]' : 'h-9 w-auto min-w-[124px] border-x border-gray-100'} bg-white px-3 text-left text-[13px] font-bold text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2" style="max-width:min(360px,calc(100vw - 9rem));" aria-expanded="false">
                        <svg class="h-4 w-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3M4 11h16M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"></path></svg>
                        <span data-drp-label class="truncate">This month</span>
                    </button>
                    <button data-drp-next type="button" class="${isSingleDate ? 'hidden' : 'h-9 w-9 inline-flex'} items-center justify-center text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-white disabled:hover:text-gray-500" aria-label="Next period">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.25" d="m9 18 6-6-6-6"></path></svg>
                    </button>
                </div>
                <div data-drp-panel class="hidden fixed z-[9999] w-[720px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
                    <div class="${isSingleDate ? 'grid grid-cols-1' : 'grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-100'}">
                        <div class="p-5">
                            <div class="flex items-center justify-between mb-5">
                                <button data-drp-calendar-prev type="button" class="h-8 w-8 inline-flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-all" aria-label="Previous calendar month">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.25" d="m15 18-6-6 6-6"></path></svg>
                                </button>
                                <h3 data-drp-left-title class="text-[15px] font-bold text-gray-900">Month</h3>
                                <span class="h-8 w-8"></span>
                            </div>
                            <div data-drp-left class="grid grid-cols-7 gap-y-2 text-center text-[13px]"></div>
                        </div>
                        <div class="${isSingleDate ? 'hidden' : 'p-5'}">
                            <div class="flex items-center justify-between mb-5">
                                <span class="h-8 w-8"></span>
                                <h3 data-drp-right-title class="text-[15px] font-bold text-gray-900">Month</h3>
                                <button data-drp-calendar-next type="button" class="h-8 w-8 inline-flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-all disabled:cursor-not-allowed disabled:opacity-35" aria-label="Next calendar month">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.25" d="m9 18 6-6-6-6"></path></svg>
                                </button>
                            </div>
                            <div data-drp-right class="grid grid-cols-7 gap-y-2 text-center text-[13px]"></div>
                        </div>
                    </div>
                    <div class="${isSingleDate ? 'hidden' : 'flex'} flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-gray-100 bg-gray-50 px-5 py-4">
                        <div class="flex items-center gap-2 text-[13px] font-bold text-gray-700">
                            <span data-drp-start class="rounded-lg border border-gray-200 bg-white px-3 py-2 min-w-[128px]">Start</span>
                            <span class="text-gray-400">-</span>
                            <span data-drp-end class="rounded-lg border border-gray-200 bg-white px-3 py-2 min-w-[128px]">End</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <button data-drp-reset type="button" class="px-4 py-2 bg-transparent text-[13px] font-bold text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-all active:scale-95">Reset</button>
                            <button data-drp-cancel type="button" class="px-4 py-2 bg-white border border-gray-200 rounded-lg text-[13px] font-bold text-gray-700 hover:bg-gray-50 transition-all active:scale-95">Cancel</button>
                            <button data-drp-apply type="button" class="px-4 py-2 bg-gray-900 text-white rounded-lg text-[13px] font-bold hover:bg-gray-800 transition-all active:scale-95">Apply</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const get = selector => host.querySelector(selector);
        const panel = get('[data-drp-panel]');
        const trigger = get('[data-drp-trigger]');
        const label = get('[data-drp-label]');
        const nextButton = get('[data-drp-next]');

        function updateLabel() {
            label.textContent = formatRangeLabel(rangeStart, rangeEnd);
            nextButton.disabled = rangeEnd >= maxDate;
        }

        function shiftPeriod(delta) {
            const daySpan = Math.max(1, Math.round((parseDayKey(rangeEnd) - parseDayKey(rangeStart)) / DAY_MS) + 1);
            const isFullMonth = rangeStart === getMonthStartKey(parseDayKey(rangeStart))
                && rangeEnd === getMonthEndKey(parseDayKey(rangeStart));
            if (isSingleDate) {
                rangeStart = addDays(rangeStart, delta);
                rangeEnd = rangeStart;
            } else if (isFullMonth) {
                const date = parseDayKey(rangeStart);
                date.setMonth(date.getMonth() + delta);
                rangeStart = getMonthStartKey(date);
                rangeEnd = getMonthEndKey(date);
            } else {
                rangeStart = addDays(rangeStart, delta * daySpan);
                rangeEnd = addDays(rangeEnd, delta * daySpan);
            }
            if (rangeEnd > maxDate) rangeEnd = maxDate;
            if (rangeStart > rangeEnd) rangeStart = rangeEnd;
            calendarBaseMonth = getMonthStartKey(parseDayKey(rangeStart));
            updateLabel();
            options.onChange?.({ start: rangeStart, end: rangeEnd });
        }

        function renderMonth(container, title, monthStartKey) {
            const monthStart = parseDayKey(monthStartKey);
            const month = monthStart.getMonth();
            title.textContent = monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            const weekdays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
            const firstGridDate = new Date(monthStart);
            firstGridDate.setDate(firstGridDate.getDate() - ((firstGridDate.getDay() + 6) % 7));
            let html = weekdays.map(day => `<div class="text-[12px] font-bold text-gray-900">${day}</div>`).join('');

            for (let index = 0; index < 42; index += 1) {
                const date = new Date(firstGridDate);
                date.setDate(firstGridDate.getDate() + index);
                const key = getDayKey(date);
                const isOutside = date.getMonth() !== month;
                const isFuture = key > maxDate;
                const isStart = key === draftStart;
                const isEnd = key === draftEnd;
                const isInRange = key >= draftStart && key <= draftEnd;
                const classes = [
                    'h-9 w-9 mx-auto rounded-full text-[13px] font-medium transition-all',
                    isOutside ? 'text-gray-400' : 'text-gray-900',
                    isInRange && !isStart && !isEnd ? 'bg-blue-50 text-blue-700' : '',
                    isStart || isEnd ? 'bg-blue-600 text-white shadow-sm' : 'hover:bg-blue-50 hover:text-blue-700',
                    isFuture ? 'opacity-30 cursor-not-allowed hover:bg-transparent hover:text-gray-400' : ''
                ].join(' ');
                html += `<button type="button" class="${classes}" data-drp-day="${key}" ${isFuture ? 'disabled' : ''}>${date.getDate()}</button>`;
            }
            container.innerHTML = html;
        }

        function renderPanel() {
            renderMonth(get('[data-drp-left]'), get('[data-drp-left-title]'), calendarBaseMonth);
            renderMonth(get('[data-drp-right]'), get('[data-drp-right-title]'), addMonths(calendarBaseMonth, 1));
            get('[data-drp-start]').textContent = formatDayLabel(draftStart);
            get('[data-drp-end]').textContent = formatDayLabel(draftEnd);
            get('[data-drp-calendar-next]').disabled = addMonths(calendarBaseMonth, 1) >= getMonthStartKey();
        }

        function selectDraftDay(dayKey) {
            if (isSingleDate) {
                draftStart = dayKey;
                draftEnd = dayKey;
                rangeStart = dayKey;
                rangeEnd = dayKey;
                togglePanel(false);
                updateLabel();
                options.onChange?.({ start: rangeStart, end: rangeEnd });
                return;
            }
            if (!draftStart || (draftStart && draftEnd && draftStart !== draftEnd)) {
                draftStart = dayKey;
                draftEnd = dayKey;
            } else if (dayKey < draftStart) {
                draftEnd = draftStart;
                draftStart = dayKey;
            } else {
                draftEnd = dayKey;
            }
            renderPanel();
        }

        function togglePanel(show) {
            const shouldShow = typeof show === 'boolean' ? show : panel.classList.contains('hidden');
            panel.classList.toggle('hidden', !shouldShow);
            trigger.setAttribute('aria-expanded', String(shouldShow));
            if (shouldShow) {
                draftStart = rangeStart;
                draftEnd = isSingleDate ? rangeStart : rangeEnd;
                calendarBaseMonth = getMonthStartKey(parseDayKey(draftStart));
                positionPanel();
                renderPanel();
            }
        }

        function positionPanel() {
            const rect = trigger.getBoundingClientRect();
            const panelWidth = Math.min(isSingleDate ? 360 : 720, window.innerWidth - 32);
            const left = Math.max(16, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 16));
            panel.style.width = `${panelWidth}px`;
            panel.style.left = `${left}px`;
            panel.style.top = `${rect.bottom + 8}px`;
        }

        trigger.addEventListener('click', event => {
            event.stopPropagation();
            togglePanel();
        });
        panel.addEventListener('click', event => {
            event.stopPropagation();
            const dayButton = event.target.closest('[data-drp-day]');
            if (!dayButton || dayButton.disabled) return;
            selectDraftDay(dayButton.dataset.drpDay);
        });
        get('[data-drp-prev]').addEventListener('click', () => shiftPeriod(-1));
        nextButton.addEventListener('click', () => shiftPeriod(1));
        get('[data-drp-calendar-prev]').addEventListener('click', () => {
            calendarBaseMonth = addMonths(calendarBaseMonth, -1);
            renderPanel();
        });
        get('[data-drp-calendar-next]').addEventListener('click', () => {
            if (addMonths(calendarBaseMonth, 1) >= getMonthStartKey()) return;
            calendarBaseMonth = addMonths(calendarBaseMonth, 1);
            renderPanel();
        });
        get('[data-drp-cancel]').addEventListener('click', () => togglePanel(false));
        get('[data-drp-reset]').addEventListener('click', () => {
            rangeStart = defaultStart;
            rangeEnd = isSingleDate ? defaultStart : defaultEnd;
            draftStart = defaultStart;
            draftEnd = isSingleDate ? defaultStart : defaultEnd;
            calendarBaseMonth = getMonthStartKey(parseDayKey(defaultStart));
            togglePanel(false);
            updateLabel();
            options.onChange?.({ start: rangeStart, end: rangeEnd });
        });
        get('[data-drp-apply]').addEventListener('click', () => {
            rangeStart = draftStart;
            rangeEnd = isSingleDate ? draftStart : draftEnd;
            togglePanel(false);
            updateLabel();
            options.onChange?.({ start: rangeStart, end: rangeEnd });
        });

        document.addEventListener('click', event => {
            if (panel.classList.contains('hidden')) return;
            if (host.contains(event.target)) return;
            togglePanel(false);
        });
        window.addEventListener('resize', () => {
            if (!panel.classList.contains('hidden')) positionPanel();
        });
        window.addEventListener('scroll', () => {
            if (!panel.classList.contains('hidden')) positionPanel();
        }, true);

        updateLabel();

        return {
            getRange: () => ({ start: rangeStart, end: rangeEnd }),
            setRange: (start, end = start) => {
                rangeStart = start;
                rangeEnd = isSingleDate ? start : end;
                updateLabel();
            },
            reset: () => {
                rangeStart = defaultStart;
                rangeEnd = isSingleDate ? defaultStart : defaultEnd;
                updateLabel();
                options.onChange?.({ start: rangeStart, end: rangeEnd });
            }
        };
    }

    window.FluxyDateRangePicker = {
        mount: mountDateRangePicker,
        getDayKey,
        addDays,
        parseDayKey,
        getMonthStartKey,
        getMonthEndKey
    };
}());
