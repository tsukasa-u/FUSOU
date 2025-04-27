import { onMount, createSignal, createResource, Show, createEffect, createMemo } from 'solid-js'
import { Chart, Title, Tooltip, Legend, Colors } from 'chart.js'
import { Line, Scatter, Bubble } from 'solid-chartjs'

// const getOrCreateTooltip = (chart: any) => {
//     let tooltipEl = chart.canvas.parentNode.querySelector('div');
  
//     if (!tooltipEl) {
//       tooltipEl = document.createElement('div');
//       tooltipEl.style.background = 'rgba(0, 0, 0, 0.7)';
//       tooltipEl.style.borderRadius = '3px';
//       tooltipEl.style.color = 'white';
//       tooltipEl.style.opacity = 1;
//       tooltipEl.style.pointerEvents = 'none';
//       tooltipEl.style.position = 'absolute';
//       tooltipEl.style.transform = 'translate(-50%, 0)';
//       tooltipEl.style.transition = 'all .1s ease';
  
//       const table = document.createElement('table');
//       table.style.margin = '0px';
  
//       tooltipEl.appendChild(table);
//       chart.canvas.parentNode.appendChild(tooltipEl);
//     }
  
//     return tooltipEl;
//   };
  
//   const externalTooltipHandler = (context: any) => {
//     // Tooltip Element
//     const {chart, tooltip} = context;
//     const tooltipEl = getOrCreateTooltip(chart);
  
//     // Hide if no tooltip
//     if (tooltip.opacity === 0) {
//       tooltipEl.style.opacity = 0;
//       return;
//     }
  
//     // Set Text
//     if (tooltip.body) {
//       const titleLines = tooltip.title || [];
//       const bodyLines = tooltip.body.map((b: any)=> b.lines);
  
//       const tableHead = document.createElement('thead');
  
//       titleLines.forEach((title: any) => {
//         const tr = document.createElement('tr');
//         tr.style.borderWidth = "0";
  
//         const th = document.createElement('th');
//         th.style.borderWidth = "0";
//         const text = document.createTextNode(title);
  
//         th.appendChild(text);
//         tr.appendChild(th);
//         tableHead.appendChild(tr);
//       });
  
//       const tableBody: HTMLTableSectionElement = document.createElement('tbody');
//       bodyLines.forEach((body: any, i: number) => {
//         const colors = tooltip.labelColors[i];
  
//         const span = document.createElement('span');
//         span.style.background = colors.backgroundColor;
//         span.style.borderColor = colors.borderColor;
//         span.style.borderWidth = '2px';
//         span.style.marginRight = '10px';
//         span.style.height = '10px';
//         span.style.width = '10px';
//         span.style.display = 'inline-block';
  
//         const tr = document.createElement('tr');
//         tr.style.backgroundColor = 'inherit';
//         tr.style.borderWidth = "0";
  
//         const td = document.createElement('td');
//         td.style.borderWidth = "0";
  
//         const text = document.createTextNode(body);
  
//         td.appendChild(span);
//         td.appendChild(text);
//         tr.appendChild(td);
//         tableBody.appendChild(tr);
//       });
  
//       const tableRoot = tooltipEl.querySelector('table');
  
//       // Remove old children
//       while (tableRoot.firstChild) {
//         tableRoot.firstChild.remove();
//       }
  
//       // Add new children
//       tableRoot.appendChild(tableHead);
//       tableRoot.appendChild(tableBody);
//     }
  
//     const {offsetLeft: positionX, offsetTop: positionY} = chart.canvas;
  
//     // Display, position, and set styles for font
//     tooltipEl.style.opacity = 1;
//     tooltipEl.style.left = positionX + tooltip.caretX + 'px';
//     tooltipEl.style.top = positionY + tooltip.caretY + 'px';
//     tooltipEl.style.font = tooltip.options.bodyFont.string;
//     tooltipEl.style.padding = tooltip.options.padding + 'px ' + tooltip.options.padding + 'px';
//   };

const MyChart = () => {

    onMount(() => {
        Chart.register(Title, Tooltip, Legend, Colors)
    });

    // createEffect(() => {
    //     const 
    // })

    const [chartData] = createResource(async () => {
        try {
            const csv_res = await fetch('/public/data_set/pokmon-platinum-exp-and-leveling-analysis-dataset/exp_types.csv')
                .then(response => response.text())
                .then((data) => {
                    return data.split('\n').map((s) => {
                        return s.split(',');
                    })
                }).then((s) => {
                    let header = s[0];
                    let body = s.slice(2).map((s_list) => s_list.map((s) => parseInt(s)));
                    return [header, body];
                }).then((data) => {
                    const chartData = {
                        labels: data[0],
                        datasets: [
                            {
                                label: 'Dimensions',
                                data: data[1].map(row => ({
                                  x: row[12] as Number,
                                  y: row[7] as Number,
                                  r: Math.log(Number(row[1]))
                                }))
                            }
                        ]
                    };
                    return chartData;
                });
            return csv_res;
        } catch (error) {
            console.log(error);
            return null;
        }
    });

    const ChartMemo = createMemo(() => {

        const chartOptions = {
            animation: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    // enabled: false,
                    // position: 'nearest',
                    // external: externalTooltipHandler
                }
            }
        };

        return <>
            <Bubble data={chartData()} options={chartOptions} width={500} height={500} />
        </>;
    })

    

    return (
        <div class="w-2/5">
            <ChartMemo />
            <Show when={chartData.loading}>
                <p>Loading...</p>
            </Show>
            <Show when={chartData.error}>
                <p>Error occured</p>
            </Show>
        </div>
    )
};

export default MyChart;