import { Slot, component$, useStylesScoped$  } from '@builder.io/qwik';

import { DeckPort } from "./interface/port.tsx";

interface TaskProps {
}
 
export const Task = component$<TaskProps>(({ }) => {

    useStylesScoped$(`
        div::before, div::after {
        //   background-color: red;
          width: 1px;
        }
      `);
    
    const task_map = [1, 2, 3, 4, 5, 6, 7]

    return (
        <>
            <li>
                <details>
                    <summary>
                        <Slot name="icon_task" />
                        Task
                    </summary>
                    <ul class="pl-0">
                        { task_map.map((_, key) => (
                            <li class="h-6">
                                <a class="justify-start gap-0">
                                    <div class="pl-2 pr-0.5 truncate flex-1 min-w-12">
                                        <div class="w-24">
                                            { "Unknown" }
                                        </div>
                                    </div>
                                    <div class="divider divider-horizontal mr-0 ml-0 flex-none"></div>
                                    <div class="w-auto">
                                        text
                                    </div>
                                    <div class="divider divider-horizontal mr-0 ml-0 flex-none"></div>
                                    <div>
                                        text
                                    </div>
                                </a>
                            </li>
                        )) }
                    </ul>
                </details>
            </li>
        </>
    );
});