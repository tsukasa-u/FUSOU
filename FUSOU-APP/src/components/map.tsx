import { Slot, component$, useStylesScoped$, useTask$ } from '@builder.io/qwik';

interface MapProps {
}

const Map = component$<MapProps>(({ }) => {

    useStylesScoped$(`
        div::before, div::after {
        //   background-color: red;
          width: 1px;
        }
    `);

    return (
        <li>
            <details>
                <summary>
                    <Slot name="icon_map" />
                    Map
                </summary>
                <ul class="pl-0">
                    <li class="h-6">
                        <a class="justify-start gap-0">
                        </a>
                    </li>
                </ul>
            </details>
        </li>
    );
});