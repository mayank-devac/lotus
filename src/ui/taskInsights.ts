import * as d3 from 'd3';
import {LotusTask} from '../types';
import {escapeHtml} from './dom';

/** Completed tasks on one calendar day (local time). */
export interface DayCompletedStats {
  dateKey: string;
  dayShort: string;
  dateLabel: string;
  isToday: boolean;
  count: number;
  titles: string[];
}

/** Completed tasks per day for the last seven days, oldest first; today is last. */
export function last7DaysCompletedStats(tasks: LotusTask[]): DayCompletedStats[] {
  const now = new Date();
  const days: DayCompletedStats[] = [];

  const toLocalKey = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  for (let i = 6; i >= 0; i--) {
    const d = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - i,
    );
    const key = toLocalKey(d);
    const dayShort =
      i === 0
        ? 'Today'
        : d.toLocaleDateString(undefined, {weekday: 'short'});
    const dateLabel = d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    days.push({
      dateKey: key,
      dayShort,
      dateLabel,
      isToday: i === 0,
      count: 0,
      titles: [],
    });
  }

  const bucketMap = new Map(days.map((item) => [item.dateKey, item]));

  for (const task of tasks) {
    if (!task.completed) continue;
    const ts = task.completedAt || task.createdAt;
    if (!ts) continue;
    const key = toLocalKey(new Date(ts));
    const bucket = bucketMap.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.titles.push(task.title);
    }
  }

  return days;
}

/**
 * Draws the 7-day bar chart (with trend line and hover tooltip) into the
 * insights section of the tasks modal in `layer`.
 */
export function renderTaskInsightsChart(layer: HTMLElement, data: DayCompletedStats[]) {
  const chartContainer = layer.querySelector(
    '#lotus-d3-insights-chart',
  ) as HTMLElement | null;
  const tooltipEl = layer.querySelector(
    '#lotus-d3-tooltip',
  ) as HTMLElement | null;

  if (!chartContainer) return;
  chartContainer.innerHTML = '';

  const width = 600;
  const height = 240;
  const margin = {top: 28, right: 24, bottom: 42, left: 40};
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const maxCount = Math.max(4, d3.max(data, (d) => d.count) ?? 4);

  const svg = d3
    .select(chartContainer)
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('class', 'lotus-d3-svg');

  const g = svg
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const x = d3
    .scaleBand<string>()
    .domain(data.map((d) => d.dayShort))
    .range([0, innerWidth])
    .padding(0.34);

  const y = d3
    .scaleLinear()
    .domain([0, maxCount])
    .nice()
    .range([innerHeight, 0]);

  // Horizontal dashed gridlines
  const yTicks = y.ticks(Math.min(6, maxCount));
  g.append('g')
    .attr('class', 'lotus-d3-grid')
    .selectAll('line')
    .data(yTicks)
    .join('line')
    .attr('x1', 0)
    .attr('x2', innerWidth)
    .attr('y1', (d) => y(d))
    .attr('y2', (d) => y(d))
    .attr('stroke', '#1B1B19')
    .attr('stroke-opacity', 0.16)
    .attr('stroke-dasharray', '3,3');

  // Y Axis
  const yAxis = d3
    .axisLeft(y)
    .ticks(Math.min(6, maxCount))
    .tickFormat((d) => `${Math.round(Number(d))}`);

  g.append('g')
    .attr('class', 'lotus-d3-axis lotus-d3-y-axis')
    .call(yAxis)
    .call((axisG) => {
      axisG.select('.domain').attr('stroke', '#1B1B19').attr('stroke-width', 2);
      axisG.selectAll('.tick line').attr('stroke', '#1B1B19');
      axisG
        .selectAll('.tick text')
        .attr('fill', '#1B1B19')
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-size', '11px')
        .attr('font-weight', '700');
    });

  // X Axis
  const xAxis = d3.axisBottom(x).tickSizeOuter(0);
  g.append('g')
    .attr('class', 'lotus-d3-axis lotus-d3-x-axis')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(xAxis)
    .call((axisG) => {
      axisG.select('.domain').attr('stroke', '#1B1B19').attr('stroke-width', 2);
      axisG.selectAll('.tick line').attr('stroke', '#1B1B19');
      axisG
        .selectAll('.tick text')
        .attr('fill', '#1B1B19')
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-size', '11px')
        .attr('font-weight', '700')
        .attr('dy', '1.15em');
    });

  // Hard-ink shadow bars behind main bars
  g.selectAll('.lotus-d3-bar-shadow')
    .data(data)
    .join('rect')
    .attr('class', 'lotus-d3-bar-shadow')
    .attr('x', (d) => (x(d.dayShort) ?? 0) + 3)
    .attr('y', (d) => (d.count > 0 ? y(d.count) + 3 : innerHeight))
    .attr('width', x.bandwidth())
    .attr('height', (d) =>
      d.count > 0 ? Math.max(0, innerHeight - y(d.count)) : 0,
    )
    .attr('fill', '#1B1B19');

  // Interactive main bars
  const bars = g
    .selectAll('.lotus-d3-bar')
    .data(data)
    .join('rect')
    .attr('class', 'lotus-d3-bar')
    .attr('x', (d) => x(d.dayShort) ?? 0)
    .attr('y', innerHeight)
    .attr('width', x.bandwidth())
    .attr('height', 0)
    .attr('fill', (d) => (d.isToday ? '#E84D2B' : '#10B981'))
    .attr('stroke', '#1B1B19')
    .attr('stroke-width', 2)
    .style('cursor', 'pointer');

  bars
    .transition()
    .duration(420)
    .ease(d3.easeCubicOut)
    .attr('y', (d) => y(d.count))
    .attr('height', (d) => Math.max(0, innerHeight - y(d.count)));

  // Smooth D3 trend line connecting daily counts
  const lineGen = d3
    .line<(typeof data)[0]>()
    .x((d) => (x(d.dayShort) ?? 0) + x.bandwidth() / 2)
    .y((d) => y(d.count))
    .curve(d3.curveMonotoneX);

  g.append('path')
    .datum(data)
    .attr('fill', 'none')
    .attr('stroke', '#1B1B19')
    .attr('stroke-width', 2)
    .attr('stroke-dasharray', '4,3')
    .attr('d', lineGen);

  // Trend points
  g.selectAll('.lotus-d3-dot')
    .data(data)
    .join('circle')
    .attr('class', 'lotus-d3-dot')
    .attr('cx', (d) => (x(d.dayShort) ?? 0) + x.bandwidth() / 2)
    .attr('cy', (d) => y(d.count))
    .attr('r', 4)
    .attr('fill', (d) => (d.isToday ? '#E84D2B' : '#F8F7F4'))
    .attr('stroke', '#1B1B19')
    .attr('stroke-width', 2);

  // Count labels above each bar
  g.selectAll('.lotus-d3-bar-label')
    .data(data)
    .join('text')
    .attr('class', 'lotus-d3-bar-label')
    .attr('x', (d) => (x(d.dayShort) ?? 0) + x.bandwidth() / 2)
    .attr('y', (d) => y(d.count) - 8)
    .attr('text-anchor', 'middle')
    .attr('fill', '#1B1B19')
    .attr('font-family', 'JetBrains Mono, monospace')
    .attr('font-size', '11px')
    .attr('font-weight', '700')
    .text((d) => `${d.count}`);

  // Hover interactions for bars
  bars
    .on('pointerenter', (event, d) => {
      if (!tooltipEl) return;
      const titlesList =
        d.titles.length > 0
          ? d.titles
              .slice(0, 3)
              .map((t) => `• ${escapeHtml(t)}`)
              .join('<br/>')
          : 'No completed tasks on this day';
      tooltipEl.innerHTML = `
        <div class="lotus-d3-tooltip-head">${escapeHtml(d.dateLabel)} · <strong>${d.count} completed</strong></div>
        <div class="lotus-d3-tooltip-body">${titlesList}</div>
      `;
      tooltipEl.style.display = 'block';
      // Absolute positioning inside the chart card: anchor next to the pointer.
      const card = chartContainer.parentElement;
      if (card && event instanceof PointerEvent) {
        const rect = card.getBoundingClientRect();
        const left = Math.max(
          6,
          Math.min(event.clientX - rect.left + 14, rect.width - 250),
        );
        const top = Math.max(6, event.clientY - rect.top + 14);
        tooltipEl.style.left = `${left}px`;
        tooltipEl.style.top = `${top}px`;
      }
    })
    .on('pointerleave', () => {
      if (tooltipEl) {
        tooltipEl.style.display = 'none';
      }
    });
}
