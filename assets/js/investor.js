(function () {
    const EXIT_VALUES = [
        1000000000,
        2500000000,
        5000000000,
        10000000000,
        25000000000,
        50000000000,
    ];

    const CUSTOMER_COUNTS = [10, 25, 50, 100, 300, 500];

    const INVESTMENT_PRESETS = [
        { label: "Rp5M", value: 5000000 },
        { label: "Rp10M", value: 10000000 },
        { label: "Rp20M", value: 20000000 },
        { label: "Rp25M", value: 25000000 },
        { label: "Rp50M", value: 50000000 },
        { label: "Rp100M", value: 100000000 },
    ];

    const ARR_MULTIPLE_PRESETS = [3, 5, 10, 15];
    const ACCESS_PASSWORD = "syududu";

    const state = {
        investment: 5000000,
        equity: 1,
        dilution: 0,
        monthlyPrice: 2790000,
        arrMultiple: 5,
    };

    const $ = (id) => document.getElementById(id);

    function safeNumber(value, fallback = 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function formatIDR(value) {
        if (!Number.isFinite(value)) return "Rp0";

        const absolute = Math.abs(value);
        const sign = value < 0 ? "-" : "";

        if (absolute >= 1000000000000) {
            return `${sign}Rp${(absolute / 1000000000000).toFixed(2)}T`;
        }

        if (absolute >= 1000000000) {
            return `${sign}Rp${(absolute / 1000000000).toFixed(2)}B`;
        }

        if (absolute >= 1000000) {
            return `${sign}Rp${(absolute / 1000000).toFixed(2)}M`;
        }

        return new Intl.NumberFormat("id-ID", {
            style: "currency",
            currency: "IDR",
            maximumFractionDigits: 0,
        }).format(value);
    }

    function formatRawIDR(value) {
        return new Intl.NumberFormat("id-ID").format(Math.round(safeNumber(value)));
    }

    function formatNumber(value) {
        return new Intl.NumberFormat("id-ID").format(Math.round(value || 0));
    }

    function calculateEffectiveEquity(equityPercent, dilutionPercent) {
        const equity = clamp(safeNumber(equityPercent), 0, 100);
        const dilution = clamp(safeNumber(dilutionPercent), 0, 100);
        return equity * (1 - dilution / 100);
    }

    function calculateImpliedPostMoney(investmentAmount, equityPercent) {
        const investment = Math.max(safeNumber(investmentAmount), 0);
        const equity = safeNumber(equityPercent);

        if (equity <= 0) return 0;

        return investment / (equity / 100);
    }

    function calculateBreakEvenExit(investmentAmount, effectiveEquityPercent) {
        const investment = Math.max(safeNumber(investmentAmount), 0);
        const effectiveEquity = safeNumber(effectiveEquityPercent);

        if (effectiveEquity <= 0) return 0;

        return investment / (effectiveEquity / 100);
    }

    function calculateExitRow(exitValue, investmentAmount, effectiveEquityPercent) {
        const investment = Math.max(safeNumber(investmentAmount), 0);
        const ownership = Math.max(safeNumber(effectiveEquityPercent), 0) / 100;
        const proceeds = safeNumber(exitValue) * ownership;
        const profit = proceeds - investment;
        const multiple = investment > 0 ? proceeds / investment : 0;
        const roi = investment > 0 ? (profit / investment) * 100 : 0;

        return { exitValue, proceeds, profit, multiple, roi };
    }

    function calculateRevenueRow(customers, monthlyPrice, arrMultiple, investmentAmount, effectiveEquityPercent) {
        const safeCustomers = Math.max(safeNumber(customers), 0);
        const safeMonthlyPrice = Math.max(safeNumber(monthlyPrice), 0);
        const safeArrMultiple = Math.max(safeNumber(arrMultiple), 0);
        const mrr = safeCustomers * safeMonthlyPrice;
        const arr = mrr * 12;
        const valuation = arr * safeArrMultiple;
        const exitRow = calculateExitRow(valuation, investmentAmount, effectiveEquityPercent);

        return {
            customers: safeCustomers,
            mrr,
            arr,
            valuation,
            proceeds: exitRow.proceeds,
            profit: exitRow.profit,
            multiple: exitRow.multiple,
        };
    }

    function setText(id, value) {
        const element = $(id);
        if (element) element.textContent = value;
    }

    function option(label, value) {
        const element = document.createElement("option");
        element.value = String(value);
        element.textContent = label;
        return element;
    }

    function renderPresetOptions() {
        const investmentSelect = $("investment-select");
        const arrMultipleSelect = $("arr-multiple-select");

        INVESTMENT_PRESETS.forEach((preset) => {
            investmentSelect.appendChild(option(preset.label, preset.value));
        });

        ARR_MULTIPLE_PRESETS.forEach((multiple) => {
            arrMultipleSelect.appendChild(option(`${multiple}x ARR`, multiple));
        });
    }

    function renderExitRows(rows, effectiveEquity) {
        const body = $("exit-scenario-body");
        body.innerHTML = "";

        rows.forEach((row) => {
            const tr = document.createElement("tr");
            const profitClass = row.profit >= 0 ? "profit-positive" : "profit-negative";

            tr.innerHTML = `
                <td class="cell-strong">${formatIDR(row.exitValue)}</td>
                <td>${effectiveEquity.toFixed(2)}%</td>
                <td class="cell-strong">${formatIDR(row.proceeds)}</td>
                <td>${row.multiple.toFixed(2)}x</td>
                <td class="${profitClass}">${formatIDR(row.profit)}</td>
                <td>${row.roi.toFixed(0)}%</td>
            `;

            body.appendChild(tr);
        });
    }

    function renderRevenueRows(rows) {
        const body = $("revenue-scenario-body");
        body.innerHTML = "";

        rows.forEach((row) => {
            const tr = document.createElement("tr");
            const profitClass = row.profit >= 0 ? "profit-positive" : "profit-negative";

            tr.innerHTML = `
                <td class="cell-strong">${formatNumber(row.customers)}</td>
                <td>${formatIDR(row.mrr)}</td>
                <td>${formatIDR(row.arr)}</td>
                <td class="cell-strong">${formatIDR(row.valuation)}</td>
                <td class="cell-strong">${formatIDR(row.proceeds)}</td>
                <td>${row.multiple.toFixed(2)}x</td>
                <td class="${profitClass}">${formatIDR(row.profit)}</td>
            `;

            body.appendChild(tr);
        });
    }

    function syncInputs() {
        $("investment-select").value = String(state.investment);
        $("investment-input").value = String(state.investment);
        $("equity-range").value = String(state.equity);
        $("equity-input").value = String(state.equity);
        $("dilution-range").value = String(state.dilution);
        $("dilution-input").value = String(state.dilution);
        $("monthly-price-input").value = String(state.monthlyPrice);
        $("arr-multiple-select").value = String(state.arrMultiple);
        $("arr-multiple-input").value = String(state.arrMultiple);
    }

    function render() {
        const effectiveEquity = calculateEffectiveEquity(state.equity, state.dilution);
        const impliedPostMoney = calculateImpliedPostMoney(state.investment, state.equity);
        const breakEvenExit = calculateBreakEvenExit(state.investment, effectiveEquity);
        const arrPerCustomer = Math.max(safeNumber(state.monthlyPrice), 0) * 12;
        const exitRows = EXIT_VALUES.map((exitValue) => calculateExitRow(exitValue, state.investment, effectiveEquity));
        const revenueRows = CUSTOMER_COUNTS.map((customers) => (
            calculateRevenueRow(customers, state.monthlyPrice, state.arrMultiple, state.investment, effectiveEquity)
        ));

        syncInputs();
        setText("investment-raw", `Raw: Rp${formatRawIDR(state.investment)}`);
        setText("equity-label", `${safeNumber(state.equity).toFixed(2)}%`);
        setText("dilution-label", `${safeNumber(state.dilution).toFixed(0)}%`);
        setText("effective-equity-copy", `${effectiveEquity.toFixed(2)}%`);
        setText("hero-effective-equity", `${effectiveEquity.toFixed(2)}%`);
        setText("arr-per-customer", formatIDR(arrPerCustomer));
        setText("implied-post-money", formatIDR(impliedPostMoney));
        setText("effective-equity-stat", `${effectiveEquity.toFixed(2)}%`);
        setText("break-even-exit", formatIDR(breakEvenExit));
        renderExitRows(exitRows, effectiveEquity);
        renderRevenueRows(revenueRows);
    }

    function bindControl(id, handler) {
        const element = $(id);
        element.addEventListener("input", (event) => {
            handler(event.target.value);
            render();
        });
        element.addEventListener("change", (event) => {
            handler(event.target.value);
            render();
        });
    }

    function setSafeInvestment(value) {
        state.investment = Math.max(safeNumber(value), 0);
    }

    function setSafeEquity(value) {
        state.equity = clamp(safeNumber(value), 0, 100);
    }

    function setSafeDilution(value) {
        state.dilution = clamp(safeNumber(value), 0, 100);
    }

    function setSafeMonthlyPrice(value) {
        state.monthlyPrice = Math.max(safeNumber(value), 0);
    }

    function setSafeArrMultiple(value) {
        state.arrMultiple = Math.max(safeNumber(value), 0);
    }

    function unlockPage() {
        $("access-overlay").hidden = true;
        $("investor-page").hidden = false;
        document.body.classList.remove("access-locked");
    }

    function initAccessGate() {
        const form = $("access-form");
        const input = $("investor-password");
        const error = $("access-error");

        document.body.classList.add("access-locked");
        input.focus();

        form.addEventListener("submit", (event) => {
            event.preventDefault();

            if (input.value === ACCESS_PASSWORD) {
                unlockPage();
                return;
            }

            error.hidden = false;
            input.select();
            input.focus();
        });
    }

    document.addEventListener("DOMContentLoaded", () => {
        initAccessGate();
        renderPresetOptions();
        bindControl("investment-select", setSafeInvestment);
        bindControl("investment-input", setSafeInvestment);
        bindControl("equity-range", setSafeEquity);
        bindControl("equity-input", setSafeEquity);
        bindControl("dilution-range", setSafeDilution);
        bindControl("dilution-input", setSafeDilution);
        bindControl("monthly-price-input", setSafeMonthlyPrice);
        bindControl("arr-multiple-select", setSafeArrMultiple);
        bindControl("arr-multiple-input", setSafeArrMultiple);
        render();
    });
}());
