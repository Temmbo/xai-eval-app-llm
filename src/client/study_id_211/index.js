/**
 * Description: Client logic for study page with two images
 *
 * Author: V Natarjan
 */


let input = null;
const API_BASE_URL = `${window.location.protocol}//${window.location.hostname}:8000`;
const button_next = document.getElementById("button-next");
const button_prev = document.getElementById("button-prev");
const button_submit = document.getElementById("button-submit");
const radio_buttons = document.getElementsByName("health");
const patient_id1 = document.getElementById("patient-id-location1");
const patient_id2 = document.getElementById("patient-id-location2");
const x_ray_location = document.getElementById("x-ray-location");
const suggested_diag1 = document.getElementById("suggested-diag-location1");
const suggested_diag2 = document.getElementById("suggested-diag-location2");
const true_diag   = document.getElementById("true-diag");
const x_ray_image = document.getElementById("patient-x-ray-image");
const x_ray_trait_span = document.getElementById("X_RAY_Trait");

const button_llm_prompt = document.getElementById("send-button");
const llm_prompt_input = document.getElementById("chat-input");

// Diagnosis hypothesis selector (Healthy / Illness 1 / 2 / 3) in the SHAP
// explanation card.
const hypothesis_selector = document.getElementById("hypothesis-selector");
const hypothesis_buttons = document.querySelectorAll(".hypothesis-btn");

function redirectIfFinished() {
    const pid = get_participant_id_from_url();
    const sid = get_study_id_from_url();
    if (sessionStorage.getItem(`study_done_${pid}_${sid}`) === 'true') {
        window.location.replace(`/feedback/index.html?participant_id=${pid}&study_id=${sid}`);
    }
}

/* run on normal page load */
redirectIfFinished();

/* run again if the page is restored from bfcache */
window.addEventListener('pageshow', (evt) => {
    if (evt.persisted) redirectIfFinished();
});



let diagnosis = null;



function get_radio_button_status()
{
    let selected_value = null; // To store the selected value
    for (const radio of radio_buttons) {
        if (radio.checked) {
            selected_value = radio.value; // Store the value of the checked radio button
            break; // Stop the loop once we find the checked radio
        }
    }

    if (!selected_value) {
        console.log("WARN: Please select an option before proceeding!"); // If no option is selected
    }

    return selected_value;
}

function set_participant_diagnosis(val) {

    if (typeof val === "string") {
        val = val.toLowerCase();
    } else {
        console.error("Invalid diagnosis string received from DB");
        return false;
    }

    if (val === "healthy") {
        document.getElementById("radio-healthy").checked = true;
    } else if (val === "ocdegen") {
        document.getElementById("radio-unhealthy").checked = true;
    } else {
        console.error("Invalid value:", val);
        return false;
    }

    return true;
}

function clear_radio_buttons() {
    for (const radio of radio_buttons) {
        radio.checked = false;
    }
}

function set_progress(current_page_nr, total_page_count) {
    let progress_value = (current_page_nr / total_page_count) * 100; // Convert to percentage
    let progress_bar = document.querySelector(".progress-bar");
    progress_bar.style.width = progress_value + "%";

    document.getElementById("progress-bar-text").textContent = "Diagnosis " + current_page_nr.toString() + "/" + total_page_count.toString();
}

function set_patient_id(id)
{
    patient_id1.textContent = id.toString();
    patient_id2.textContent = "X-Ray ID: " + id.toString();
}

function set_x_ray_image(src)
{
    x_ray_image.src = src;
}

function get_x_ray_image()
{
    return x_ray_image.src;
}

function get_params_from_url()
{
    const params = new URLSearchParams(window.location.search);

    return {
        participant_id: params.get('participant_id') ? decodeURIComponent(params.get('participant_id')) : null,
        study_id: params.get('study_id') ? decodeURIComponent(params.get('study_id')) : null,
        study_type: params.get('study_id') ? decodeURIComponent(params.get('study_type')) : null,
        page_nr: params.get('page_nr') ? decodeURIComponent(params.get('page_nr')) : null,
        total_pages: params.get('total_pages') ? decodeURIComponent(params.get('total_pages')) : null,
    };
}

function update_study_url(participant_id, study_id, study_type, page_nr, total_pages)
{
    let new_url = "/study_id_";
    new_url += study_id + "/";
    new_url += "index.html?";
    new_url += "participant_id=" +participant_id;
    new_url += "&study_id=" + study_id;
    new_url += "&study_type=" + study_type;
    new_url += "&page_nr=" + page_nr;
    new_url += "&total_pages=" + total_pages;
    history.pushState(null, '', new_url);
}

async function log_page_visit(participant_id, study_id, page_nr) {
    console.log('logging visit:', participant_id, study_id, page_nr);

    try {
        const response = await fetch('/log_visit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ participant_id, study_id, page_nr })
        });

        const response_data = await response.json(); // Read JSON response

        if (!response.ok) {
            console.error('Failed to log visit:', response_data);
        }
    } catch (error) {
        console.error('Error logging visit:', error);
    }
}

async function db_update_async()
{
    console.log("Updating database...");
    const participant_diagnosis = get_radio_button_status();
    let participant_id = get_participant_id_from_url();
    let study_id = get_study_id_from_url();
    let page_nr = get_page_nr_from_url();

    if (!participant_id) {
        console.log("Error: URL doesn’t have participant_id");
        return;
    }

    if (!study_id) {
        console.log("Error: URL doesn’t have study_id");
        return;
    }

    let xray_image_url = get_x_ray_image();
    let xray_image = xray_image_url;
    //let xray_image = xray_image_url.split('/').pop(); // Extracts "05.png"

    try {
        const response = await fetch('/write_db', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ participant_id, study_id, xray_image, participant_diagnosis, page_nr })
        });

        const response_data = await response.json(); // Read JSON response

        if (!response.ok) {
            if (response.status === 400 && response_data.error === "DUPLICATE ENTRY") {
                console.log('Entry already exists. Cannot submit duplicate.');
                db_update_duplicate_entry_action(participant_id, study_id, page_nr);
                //ToDo: Get and Set actual Entry in the database ( Diagnosis )
            } else {
                console.log('Database error occurred. Please try again.');
            }
        } else {
            db_update_success_action(participant_id, study_id, page_nr);
        }
    } catch (error) {
        console.error('Error:', error);
        console.log('Something went wrong. Please try again.');
    }

}

async function db_update() {
    try {
        //await function make the fn block until it completes exec
        await db_update_async();
        console.log("Database update completed successfully.");
    } catch (error) {

        console.error("Error during database update:", error);
    }
}

function db_update_success_action(participant_id, study_id, current_page_nr) {
    //Last Page
    if (current_page_nr >= csv_json_get_total_page_count()) {
        const feedback_url = `/feedback/index.html?participant_id=${participant_id}&study_id=${study_id}`;

        /* NEW — remember that this study is done in this tab */
        sessionStorage.setItem(`study_done_${participant_id}_${study_id}`, 'true');

        window.location.replace(feedback_url);
        return;
    }

    //increment page number
    page_nr = current_page_nr + 1;
    up = get_params_from_url();
    update_study_url(participant_id, study_id, up.study_type, page_nr, up.total_pages);
    clear_radio_buttons();
    csv_json_get_all_attributes_and_set_in_html_page(page_nr);
    db_get_and_set_participant_diagnosis(participant_id, study_id, page_nr);
    button_toggle_next_or_submit();
    log_page_visit(participant_id, study_id, page_nr);
    sync_blocky_prediction_to_backend(page_nr);
}

function button_toggle_next_or_submit() {
    const up = get_params_from_url();
    let total_pages = parseInt(up.total_pages, 10);
    let curr_page = parseInt(up.page_nr, 10);

    // If page_nr is missing or not a number, treat it as page 1
    if (isNaN(curr_page) || curr_page < 1) { curr_page = 1; }
    if (isNaN(total_pages) || total_pages < 1) { total_pages = 1; }

    /* default state: show both buttons in normal style */
    button_prev.style.display = 'none';
    button_prev.disabled = true;
    button_next.style.display = 'inline-block';
    button_next.disabled = get_radio_button_status() === null;
    button_submit.disabled = true;

    /* ---- first page: hide Prev ---- */
    if (curr_page === 1) {
        // button_prev.style.display = 'none';
        button_prev.disabled = true;
        return;
    }

    /* last page: show Prev + floating Submit */
    if (curr_page === total_pages) {
        button_next.disabled = true;
        return;
    }
}

function db_update_duplicate_entry_action(participant_id, study_id, current_page_nr) {
    //Last Page
    if (current_page_nr >= csv_json_get_total_page_count()) {
        sessionStorage.setItem(`study_done_${participant_id}_${study_id}`, 'true');
        window.location.replace(`/feedback/index.html?participant_id=${participant_id}&study_id=${study_id}`);
        return;
    }

    //increment page number
    page_nr = current_page_nr + 1;
    up = get_params_from_url();
    update_study_url(participant_id, study_id, up.study_type, page_nr, up.total_pages);
    clear_radio_buttons();
    csv_json_get_all_attributes_and_set_in_html_page(page_nr);
    db_get_and_set_participant_diagnosis(participant_id, study_id, page_nr);
    log_page_visit(participant_id, study_id, page_nr);
    sync_blocky_prediction_to_backend(page_nr);
}


function next_button_action()
{
    
    let ret = get_radio_button_status();
    if(ret == null ){
        alert("Please select an option before proceeding to the next page.");
        return;
    }

    db_update();

    // Hide the card content again after advancing
    const card = document.querySelector(".card-row2-col2");
    if (card) {
        const content = card.querySelector(".card-content");
        const hint = card.querySelector(".toggle-hint");

        if (content && hint) {
            // Temporarily disable transition to avoid flicker
            content.style.transition = "none";
            content.classList.remove("show");
            hint.classList.remove("hidden");

            // Force reflow so browser applies style
            void content.offsetHeight;

            // Re-enable transitions for next user toggle
            content.style.transition = "";
        }
    }

}




function get_or_create_llm_session_id() {
    const participant_id = get_participant_id_from_url();
    const study_id = get_study_id_from_url();
    // Stable per participant+study, so backend session state persists across pages
    return `${participant_id}_${study_id}`;
}

// input.json encodes a compound concept (e.g. "Medium-Low Spine Bend &
// Slightly Extended Head") as two parallel arrays: concept_raw is an array
// of trait names, value_raw the matching array of per-trait values. A plain
// row has both as plain scalars instead. This turns either shape into the
// backend's Concept payload: {name, value?, score, diagnosis_support,
// components?} - `components` only appears for the compound case, one
// entry per sub-trait, so no sub-value ever has to be dropped or guessed.
function build_concept_payload(concept_raw, value_raw, score, diagnosis_support) {
    const is_compound = Array.isArray(concept_raw) || Array.isArray(value_raw);

    if (!is_compound) {
        return {
            name: concept_raw,
            value: value_raw,
            score: score,
            diagnosis_support: diagnosis_support
        };
    }

    const names = Array.isArray(concept_raw) ? concept_raw : [concept_raw];
    const values = Array.isArray(value_raw) ? value_raw : [value_raw];

    if (names.length !== values.length) {
        console.warn(
            "Concept name/value length mismatch, using shorter length:",
            concept_raw, value_raw
        );
    }

    const pair_count = Math.min(names.length, values.length);
    const components = [];
    for (let i = 0; i < pair_count; i++) {
        components.push({
            // Strip a leading "& " continuation marker so component names
            // read as standalone traits, e.g. "& Slightly Extended Head"
            // -> "Slightly Extended Head".
            name: String(names[i]).replace(/^&\s*/, ""),
            value: values[i]
        });
    }

    return {
        name: names.join(" "),
        score: score,
        diagnosis_support: diagnosis_support,
        components: components
    };
}

async function sync_blocky_prediction_to_backend(page_nr) {
    const session_id = get_or_create_llm_session_id();
 
    // attr = [patient_id, image, x_ray_loc, true_diag, suggested_diag, trait]
    const attr = csv_json_get_main_attributes(page_nr);
    const suggested_diag = attr[4];

    // The backend's "concepts" field is a list of Concept objects, each
    // {name, value, score, diagnosis_support} (plus an optional
    // `components` list for compound concepts - see build_concept_payload
    // below). All 5 concept slots from input.json are sent.
    const conceptsList = csv_json_get_concept_attributes(page_nr);

    // Map to the backend's Concept shape. Most rows are a simple
    // {concept: string, value: number} pair, but some are compound - two
    // parallel arrays like concept: ["Main Bones: Sharp Cuboids",
    // "& Slightly Extended Head"], value: [0.15, 0.45]. build_concept_payload
    // turns those into an explicit `components` list instead of silently
    // dropping them.
    const concepts = conceptsList
        .filter(c => {
            const ok = typeof c.score === "number" && !!c.diagnosis_support;
            if (!ok) {
                console.warn(
                    `Skipping malformed concept (page ${page_nr}):`, c
                );
            }
            return ok;
        })
        .map(c => build_concept_payload(c.concept, c.value, c.score, c.diagnosis_support));

    if (concepts.length === 0) {
        console.warn(`Skipping blocky context sync (page ${page_nr}): no valid concepts`);
        return;
    }
 
    try {
        const response = await fetch(`${API_BASE_URL}/api/context`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                session_id: session_id,
                prediction: suggested_diag,
                concepts: concepts
            })
        });
 
        if (!response.ok) {
            const errText = await response.text();
            console.error(`Failed to sync blocky context (page ${page_nr}): ${response.status} ${errText}`);
        }
    } catch (error) {
        console.error(`Error syncing blocky context (page ${page_nr}):`, error);
    }
}


async function llm_button_action()
{
    let user_input = llm_prompt_input.value.trim();
    if(user_input == ""){
        alert("Please enter a prompt before sending to the LLM.");
        return;
    }
 
    const session_id = get_or_create_llm_session_id();
    const chatArea = document.getElementById("llm-chat-messages");
 
    // Show the user's message immediately
    const userMessage = document.createElement("div");
    userMessage.className = "message user-message";
    userMessage.textContent = `You: ${user_input}`;
    chatArea.appendChild(userMessage);
 
    // Clear input right away for responsiveness
    llm_prompt_input.value = "";
    button_llm_prompt.disabled = true;
 
    try {
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                session_id: session_id,
                message: user_input,
            })
        });
 
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Server responded ${response.status}: ${errText}`);
        }
 
        const data = await response.json();
 
        const botMessage = document.createElement("div");
        botMessage.className = "message bot-message";
        botMessage.textContent = `LLM: ${data.answer}`;
        chatArea.appendChild(botMessage);
 
        chatArea.scrollTop = chatArea.scrollHeight;
        get_template_from_llm(); // Refresh the template buttons after each LLM response
    } catch (error) {
        console.error('Error:', error);
        const errorMessage = document.createElement("div");
        errorMessage.className = "message bot-message error";
        errorMessage.textContent = "There was an error processing your request. Please try again.";
        chatArea.appendChild(errorMessage);
    } finally {
        button_llm_prompt.disabled = false;
    }
}

async function get_template_from_llm() {
    // This function obtains the three recommended chat inputs from the LLM and populates the corresponding buttons in the UI.
    const session_id = get_or_create_llm_session_id();
    const templateButtons = [
        document.getElementById("llm-template-1"),
        document.getElementById("llm-template-2"),
        document.getElementById("llm-template-3")
    ];
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/templates`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ session_id: session_id })
        });
 
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Server responded ${response.status}: ${errText}`);
        }
 
        const data = await response.json();
 
        // Populate the buttons with the received templates
        templateButtons.forEach((button, index) => {
            if (data.templates[index]) {
                button.textContent = data.templates[index];
                button.disabled = false;
                button.onclick = () => {
                    llm_prompt_input.value = data.templates[index];
                    llm_button_action();
                };
            } else {
                button.textContent = "No template available";
                button.disabled = true;
            }
        });
    } catch (error) {
        console.error('Error fetching templates:', error);
    }
}


async function db_get_and_set_participant_diagnosis_prev_button_click(participant_id, study_id, page_nr) {
    console.log("db_get_and_set_participant_diagnosis_prev_button_click");
    try {
        const response = await fetch(`/read_db_prev?participant_id=${participant_id}&study_id=${study_id}&page_nr=${page_nr}`);
        const data = await response.json();

        if (Array.isArray(data) && data.length > 0) {
            diagnosis = data[0].participant_diagnosis;
            //First URL Update
            up = get_params_from_url();
            update_study_url(participant_id, study_id, up.study_type, page_nr, up.total_pages);
            set_participant_diagnosis(diagnosis);
            //Set all attributes from csv_json info
            csv_json_get_all_attributes_and_set_in_html_page(page_nr);
            log_page_visit(participant_id, study_id, page_nr);
            console.log(diagnosis);
        }
        button_toggle_next_or_submit();
    } catch (error) {
        console.error('Error fetching data:', error);
    }
}

async function db_get_and_set_participant_diagnosis(participant_id, study_id, page_nr) {
    console.log("db_get_participant_diagnosis");
    try {
        const response = await fetch(`/read_db_prev?participant_id=${participant_id}&study_id=${study_id}&page_nr=${page_nr}`);
        const data = await response.json();

        if (Array.isArray(data) && data.length > 0) {
            diagnosis = data[0].participant_diagnosis;
            set_participant_diagnosis(diagnosis);
            console.log(diagnosis);
        }
        button_toggle_next_or_submit();
    } catch (error) {
        console.error('Error fetching data:', error);
        button_toggle_next_or_submit();
    }
}

async function prev_button_action()
{
    let participant_id = get_participant_id_from_url();
    let study_id = get_study_id_from_url();
    let curr_page_nr = get_page_nr_from_url();

    if(curr_page_nr == 1){
        console.log("You are already in the first page!");
        return;
    }

    prev_page_nr = curr_page_nr - 1;
    db_get_and_set_participant_diagnosis_prev_button_click(participant_id, study_id, prev_page_nr);
}

async function radio_button_changed() {
    let ret = get_radio_button_status();
    let curr_page_nr = get_page_nr_from_url();
    const up = get_params_from_url();
    let total_pages = parseInt(up.total_pages, 10);

    if (ret == null) {
        button_next.disabled = true;
        button_submit.disabled = true;
        return;
    }

    if (curr_page_nr == total_pages) {
        button_next.disabled = true;
        button_submit.disabled = false;
    } else {
        button_next.disabled = false;
        button_submit.disabled = true;
    }
}

function set_suggested_diag(value) {
    suggested_diag1.textContent = value;
    suggested_diag2.textContent = value;

    p_card = document.getElementById("patient-card");

    if (value == "OCDegen") {
        // suggested_diag1.className = "";
        suggested_diag2.className = "";
        // suggested_diag1.className = "unhealthy"
        suggested_diag2.className = "unhealthy"
        p_card.classList.remove('healthy')
        p_card.classList.add('unhealthy')
    } else {
        // suggested_diag1.className = "";
        suggested_diag2.className = "";
        // suggested_diag1.className = "healthy"
        suggested_diag2.className = "healthy"
        p_card.classList.remove('unhealthy')
        p_card.classList.add('healthy')
    }
}

function set_x_ray_location(value)
{
    x_ray_location.textContent = value;
}

function set_true_diag(value)
{
    true_diag.textContent = value;
    if(value == "OCDegen"){
        true_diag.className = ""
        true_diag.className = "unhealthy"
    }else{
        true_diag.className = ""
        true_diag.className = "healthy"
    }

}

//get total pagecount for the study
function csv_json_get_total_page_count()
{
    return input.PATIENT_ID.length;
}

function csv_json_get_main_attributes(page_nr)
{
    index = window.shuffledIndices[page_nr-1]; // get the shuffled index for this page number

    if (index === undefined || input.PATIENT_ID[index] === undefined) {
        showError(`No data for page ${page_nr} (index ${index}). Check that total_pages in the URL matches input.json length (${input.PATIENT_ID.length}).`);
        return [null, null, null, null, null];
    }

    l_patient_id = input.PATIENT_ID[index];
    l_x_ray_loc  = input.X_RAY_LOCATION[index];
    l_true_diag = input.TRUE_DIAG[index];
    l_suggested_diag = input.SUGGESTED_DIAG[index];
    l_image = "img/" + input.X_RAY_IMAGE[index];
    attributes = [l_patient_id, l_image, l_x_ray_loc, l_true_diag, l_suggested_diag]
    return attributes;
}

function set_main_attributes_in_html_page(page_nr, attr)
{
    //attributes = [patient_id, image, x_ray_loc, true_diag, suggested_diag]
    set_patient_id(attr[0]);
    set_x_ray_image(attr[1]);
    set_x_ray_location(attr[2]);
    set_true_diag(attr[3]);
    set_suggested_diag(attr[4])
    set_progress(page_nr, csv_json_get_total_page_count());
}

function csv_json_get_all_attributes_and_set_in_html_page(page_nr)
{
    attr = csv_json_get_main_attributes(page_nr);
    set_main_attributes_in_html_page(page_nr, attr);
    attr = csv_json_get_additional_attributes(page_nr);
    set_additional_attributes_in_html_page(page_nr, attr);
}

function csv_json_get_concept_attributes(page_nr)
{
    index = window.shuffledIndices[page_nr-1]; // get the shuffled index for this page number

    concepts = [];
    for (let c = 1; c <= 5; c++) {
        concepts.push({
            concept: input[`Concept${c}_concept`][index],
            value: input[`Concept${c}_value`][index],
            score: input[`Concept${c}_score`][index],
            diagnosis_support: input[`Concept${c}_diagnosis_support`][index],
        });
    }

    return concepts;
}

function csv_json_get_additional_attributes(page_nr)
{
    index = window.shuffledIndices[page_nr-1]; // get the shuffled index for this page number
    l_patient_id = input.PATIENT_ID[index];
    concept_card_1_title    = "Important Features";
    // concept_card_1_image    = "img/"       + input.Shap[index];
    concept_card_1_image    = "img/" + input.contribution_plot[index];
    attributes = [concept_card_1_title, concept_card_1_image];
    return attributes;
}

function set_additional_attributes_in_html_page(page_nr, attr)
{
    document.getElementById("concept-card-1-title").textContent = attr[0];
    document.getElementById("concept-card-1-image").src = attr[1];
    document.getElementById("concept-card-1-caption").textContent = attr[2];
}

// --- Diagnosis hypothesis selector (Healthy / Illness 1 / 2 / 3) ---------
// Handles ONLY the clicking/highlighting behaviour of the selector in the
// SHAP explanation card. Loading/swapping the corresponding explanation
// graph per hypothesis is not implemented yet - hypothesis_selected() below
// is where that data-switching logic can be added later.

function set_active_hypothesis_button(hypothesis) {
    hypothesis_buttons.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.hypothesis === hypothesis);
    });
}

function hypothesis_selected(hypothesis) {
    console.log("Hypothesis selected:", hypothesis);
    // TODO: load/display the explanation graph for this hypothesis.
}

async function load_json_data() {
    try {
        const response = await fetch("input.json"); // Fetch JSON asynchronously
        if (!response.ok) {
            throw new Error("Network response was not ok");
        }
        input = await response.json();  // Set input with the loaded JSON
        console.log('Data loaded:', input);  // Debug: Confirm input data loaded
        await init_page();
        // Fetch LLM templates and populate the template buttons
        await get_template_from_llm();

        // Study doesn't start via the "Weiter" button, so sync the
        // first blocky's prediction here once init_page() has set it up.
        const start_page_nr = get_page_nr_from_url();
        sync_blocky_prediction_to_backend(start_page_nr);
    } catch (error) {
        console.error("There was a problem with the fetch operation:", error);
        input = null;  // Reset input in case of error
    }
}

document.addEventListener('DOMContentLoaded', async function() {
    await load_json_data();
});

button_next.addEventListener("click", function() {
    next_button_action();
});

button_submit.addEventListener("click", function () {
    next_button_action();
});

button_prev.addEventListener("click", function () {
    prev_button_action();
});


button_llm_prompt.addEventListener("click", function() {
    llm_button_action();
});

llm_prompt_input.addEventListener("keypress", function(event) {
    if (event.key === "Enter") {
        event.preventDefault(); // Prevent the default action (form submission)
        llm_button_action();
    }
});


radio_buttons.forEach((radio) => {
    radio.addEventListener("change", function () {
        radio_button_changed();
    });
});

hypothesis_buttons.forEach((btn) => {
    btn.addEventListener("click", function () {
        const hypothesis = btn.dataset.hypothesis;
        if (btn.classList.contains("active")) return; // already selected, nothing to do

        set_active_hypothesis_button(hypothesis);
        hypothesis_selected(hypothesis);
    });
});

// Keeps the page in-sync when the user clicks the browser Back/Forward buttons
function preventBack() {
    history.pushState(null, "", window.location.href);
}

window.addEventListener("load", preventBack);

window.addEventListener('popstate', () => {

    preventBack();
    
    const pid = get_participant_id_from_url();
    const sid = get_study_id_from_url();
    if (sessionStorage.getItem(`study_done_${pid}_${sid}`) === 'true') {
        window.location.replace(`/feedback/index.html?participant_id=${pid}&study_id=${sid}`);
        return;               // nothing else in the handler runs
    }

    const page_nr = get_page_nr_from_url();

    // Refresh the main content for the new page number
    csv_json_get_all_attributes_and_set_in_html_page(page_nr);

    // Re-load any diagnosis already stored for that page
    db_get_and_set_participant_diagnosis(
        get_participant_id_from_url(),
        get_study_id_from_url(),
        page_nr
    );

    // Update the Next/Submit button label
    button_toggle_next_or_submit();
});

// Toggle card content visibility on click for tutorial only
document.addEventListener("DOMContentLoaded", function () {
    const card = document.querySelector(".card-row2-col2");
    const content = card.querySelector(".card-content");
    const hint = card.querySelector(".toggle-hint");

    card.addEventListener("click", function (event) {
        // prevent re-triggering when clicking inside the content
        if (event.target.closest(".card-content")) return;

        content.classList.toggle("show");
        hint.classList.toggle("hidden");
    });
})