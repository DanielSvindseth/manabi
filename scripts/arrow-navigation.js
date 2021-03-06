/**
 * Makes it so the left and right arrows change focus, ala Tab/Shift+Tab. This is mostly designed
 * for KaiOS devices.
 */
/* global document, addEventListener, removeEventListener, getSelection */
// TODO: email/number types are a special type, in that they return selectionStart/selectionEnd as null
// As far as I can tell, there is no way to actually get the caret position from these inputs. So we
// don't do the proper caret handling for those inputs, unfortunately.
// https://html.spec.whatwg.org/multipage/input.html#do-not-apply
var textInputTypes = ['text', 'search', 'url', 'password', 'tel'];
var checkboxRadioInputTypes = ['checkbox', 'radio'];
var focusTrapTest = undefined;
// This query is adapted from a11y-dialog
// https://github.com/edenspiekermann/a11y-dialog/blob/cf4ed81/a11y-dialog.js#L6-L18
var focusablesQuery = 'a[href], area[href], input, select, textarea, ' +
    'button, iframe, object, embed, [contenteditable], [tabindex], ' +
    'video[controls], audio[controls], summary';
function getActiveElement() {
    var activeElement = document.activeElement;
    while (activeElement.shadowRoot) {
        activeElement = activeElement.shadowRoot.activeElement;
    }
    return activeElement;
}
function isFocusable(element) {
    return element.matches(focusablesQuery) &&
        !element.disabled &&
        !/^-/.test(element.getAttribute('tabindex') || '') &&
        !element.hasAttribute('inert') && // see https://github.com/GoogleChrome/inert-polyfill
        (element.offsetWidth > 0 || element.offsetHeight > 0);
}
function getFocusTrapParent(element) {
    if (!focusTrapTest) {
        return;
    }
    var parent = element.parentElement;
    while (parent) {
        if (focusTrapTest(parent)) {
            return parent;
        }
        parent = parent.parentElement;
    }
}
function shouldIgnoreEvent(activeElement, forwardDirection) {
    var tagName = activeElement.tagName;
    var isTextarea = tagName === 'TEXTAREA';
    var isTextInput = tagName === 'INPUT' &&
        textInputTypes.indexOf(activeElement.getAttribute('type').toLowerCase()) !== -1;
    var isContentEditable = activeElement.hasAttribute('contenteditable');
    if (!isTextarea && !isTextInput && !isContentEditable) {
        return false;
    }
    var selectionStart;
    var selectionEnd;
    var len;
    if (isContentEditable) {
        var selection = getSelection();
        selectionStart = selection.anchorOffset;
        selectionEnd = selection.focusOffset;
        len = activeElement.textContent.length;
    }
    else {
        selectionStart = activeElement.selectionStart;
        selectionEnd = activeElement.selectionEnd;
        len = activeElement.value.length;
    }
    // if the cursor is inside of a textarea/input, then don't focus to the next/previous element
    // unless the cursor is at the beginning or the end
    if (!forwardDirection && selectionStart === selectionEnd && selectionStart === 0) {
        return false;
    }
    else if (forwardDirection && selectionStart === selectionEnd && selectionStart === len) {
        return false;
    }
    return true;
}
function getNextCandidateNodeForShadowDomPolyfill(root, targetElement, forwardDirection, filter) {
    // When the shadydom polyfill is running, we can't use TreeWalker on ShadowRoots because
    // they aren't real Nodes. So we do this workaround where we run TreeWalker on the
    // children instead.
    var nodes = Array.prototype.slice.call(root.querySelectorAll('*'));
    var idx = nodes.indexOf(targetElement);
    if (forwardDirection) {
        nodes = nodes.slice(idx + 1);
    }
    else {
        if (idx === -1) {
            idx = nodes.length;
        }
        nodes = nodes.slice(0, idx);
        nodes.reverse();
    }
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node instanceof HTMLElement && filter.acceptNode(node) === NodeFilter.FILTER_ACCEPT) {
            return node;
        }
    }
    return undefined;
}
function getNextCandidateNode(root, targetElement, forwardDirection, filter) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, filter);
    if (targetElement) {
        walker.currentNode = targetElement;
    }
    if (forwardDirection) {
        return walker.nextNode();
    }
    else if (targetElement) {
        return walker.previousNode();
    }
    // iterating backwards through shadow root, use last child
    return walker.lastChild();
}
function isShadowDomPolyfill() {
    return typeof ShadowRoot !== 'undefined' &&
        // ShadowRoot.polyfill is just a hack for our unit tests
        ('polyfill' in ShadowRoot || !ShadowRoot.toString().includes('[native code]'));
}
function getNextNode(root, targetElement, forwardDirection) {
    var filter = {
        acceptNode: function (node) {
            return (node === targetElement || node.shadowRoot || isFocusable(node))
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_SKIP;
        }
    };
    // TODO: remove this when we don't need to support the Shadow DOM polyfill
    var nextNode = isShadowDomPolyfill() && root instanceof ShadowRoot
        ? getNextCandidateNodeForShadowDomPolyfill(root, targetElement, forwardDirection, filter)
        : getNextCandidateNode(root, targetElement, forwardDirection, filter);
    if (nextNode && nextNode.shadowRoot) { // push into the shadow DOM
        return getNextNode(nextNode.shadowRoot, null, forwardDirection);
    }
    if (!nextNode && root.host) { // pop out of the shadow DOM
        return getNextNode(root.host.getRootNode(), root.host, forwardDirection);
    }
    return nextNode;
}
function focusNextOrPrevious(event, key) {
    var activeElement = getActiveElement();
    var forwardDirection = key === 'ArrowRight';
    if (shouldIgnoreEvent(activeElement, forwardDirection)) {
        return;
    }
    var root = getFocusTrapParent(activeElement) || activeElement.getRootNode();
    var nextNode = getNextNode(root, activeElement, forwardDirection);
    if (nextNode && nextNode !== activeElement) {
        nextNode.focus();
        event.preventDefault();
    }
}
function handleEnter(event) {
    var activeElement = getActiveElement();
    if (activeElement.tagName === 'INPUT' &&
        checkboxRadioInputTypes.indexOf(activeElement.getAttribute('type').toLowerCase()) !== -1) {
        // Explicitly override "enter" on an input and make it fire the checkbox/radio
        activeElement.click();
        event.preventDefault();
    }
}
function keyListener(event) {
    if (event.altKey || event.metaKey || event.ctrlKey) {
        return; // ignore e.g. Alt-Left and Ctrl-Right, which are used to switch browser tabs or navigate back/forward
    }
    var key = event.key;
    switch (key) {
        case 'ArrowLeft':
        case 'ArrowRight': {
            focusNextOrPrevious(event, key);
            break;
        }
        case 'Enter': {
            handleEnter(event);
            break;
        }
    }
}
/**
 * Start listening for keyboard events. Attaches a listener to the window.
 */
function register() {
    addEventListener('keydown', keyListener);
}
/**
 * Stop listening for keyboard events. Unattaches a listener to the window.
 */
function unregister() {
    removeEventListener('keydown', keyListener);
}
/**
 * Set a focus trap test to identify any focus traps in the DOM, i.e. a top-level DOM node that indicates the root
 * of a focus trap. Once this is set, if focus changes within the focus trap, then will not leave the focus trap.
 * @param test: the test function
 * @see https://w3c.github.io/aria-practices/examples/dialog-modal/dialog.html
 */
function setFocusTrapTest(test) {
    focusTrapTest = test;
}

export { register, setFocusTrapTest, unregister };
//# sourceMappingURL=index.js.map
