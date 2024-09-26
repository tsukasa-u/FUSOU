import { component$, JSXOutput, useComputed$, PropsOf, useStyles$ } from '@builder.io/qwik';

import { HiXMarkOutline } from '@qwikest/icons/heroicons';

import toast_style from "./fade_toast.css?inline";

interface FadeToastProps {
    toast_id: string;
}

export const showFadeToast = function(id: string, mesage: string) {
    let toast = document.getElementById(id);
    if (toast) {

        let message_container = document.createElement("div");
        message_container.classList.add("place-content-between");
        message_container.classList.add("alert");
        message_container.classList.add("border-base-content");
        message_container.classList.add("min-w-60");
        message_container.classList.add("rounded-lg");
        message_container.classList.add("shadow");
        message_container.classList.add("flex");
        message_container.id = "fade_toast_message"+self.crypto.randomUUID();
        message_container.style.display = "none";
        
        let new_message = document.createElement("span");
        new_message.classList.add("flex");
        new_message.classList.add("flex-nowarp");
        new_message.innerHTML +='<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6"><path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" /></svg>' + '<span class="w-2"></span>' + mesage;

        let close_element = document.createElement("div");
        close_element.innerHTML += '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" class="size-4"><path fill-rule="evenodd" d="M5.47 5.47a.75.75 0 0 1 1.06 0L12 10.94l5.47-5.47a.75.75 0 1 1 1.06 1.06L13.06 12l5.47 5.47a.75.75 0 1 1-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 0 1-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" /></svg>';
      
        // close_element.classList.add("cursor-pointer");
        close_element.classList.add("btn");
        close_element.classList.add("btn-ghost");
        close_element.classList.add("btn-sm");
        close_element.classList.add("btn-circle");
        close_element.classList.add("absolute");
        close_element.classList.add("top-3");
        close_element.classList.add("right-3");
        close_element.onclick = hideFadeToast.bind(null, message_container.id);

        message_container.appendChild(new_message);
        message_container.appendChild(close_element);

        toast.prepend(message_container);

        let container_ref = document.getElementById(message_container.id);

        if (container_ref) {
            container_ref.style.display = "block";
            container_ref.classList.add('fadein');
            
            new Promise<void>((resolve) => {
                setTimeout(() => {
                    container_ref.classList.remove('fadein');
                    resolve();
                }, 500);
            })
            .then(() => {
                return new Promise<void>((resolve) => {
                    setTimeout(() => {
                        container_ref.classList.add('fadeout');
                        resolve();
                    }, 3000);
                });
            })
            .then(() => {
                return new Promise<void>((resolve) => {
                    setTimeout(() => {
                        container_ref.classList.remove('fadeout');
                        container_ref.style.display = "none";
                        container_ref.remove();
                        resolve();
                    }, 500);
                });
            });
        }
    }
}

export const hideFadeToast = function(id: string) {
    let new_message = document.getElementById(id);
    if (new_message) {
        if (new_message.style.display === "none") return;
        new_message.classList.add('fadeout');
        setTimeout(() => {
            new_message.classList.remove('fadeout');
            new_message.style.display = "none";
            new_message.remove();
        }, 1000);
    }
}

export const FadeToast = component$(({toast_id, ...props}: FadeToastProps & PropsOf<'div'>) => {

    useStyles$(toast_style);

    return <>
        <div class="toast toast-end" {...props}>
            <div class="stack" id={toast_id}>
                {/* <div class="flex justify-between alert alert-info" id="test_1dagaa-agddgasg-gdaga">
                    <span>Toast</span>
                    <span onClick$={() => {hideFadeToast("test_1")}}><HiXMarkOutline></HiXMarkOutline></span>
                </div> */}
            </div>
        </div>
    </>;
});