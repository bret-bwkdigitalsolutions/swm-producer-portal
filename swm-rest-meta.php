<?php                                                                                                                                                            
  /**                                                                                                                                                              
   * Register SWM meta fields for REST API access.                                                                                                                 
   */                                                                                                                                                              
  add_action('init', function () {                                                                                                                                 
      $meta_fields = [                   
          'swm_review' => ['_swm_show_id', '_swm_reviewer_name', '_swm_review_category', '_swm_rating', '_swm_poster_url'],                                        
          'swm_trailer' => ['_swm_show_id', '_swm_youtube_url', '_swm_release_date'],    
      ];                       
                                         
      foreach ($meta_fields as $post_type => $fields) {
          foreach ($fields as $field) {                                                                                                                            
              register_post_meta($post_type, $field, [
                  'show_in_rest' => true,                                                                                                                          
                  'single' => true,                                                      
                  'type' => 'string',                                                                                                                              
                  'auth_callback' => function () {                                       
                      return current_user_can('edit_posts');                                                                                                       
                  },                                                                     
              ]);                                                                                                                                                  
          }               
      }                                                                                                                                                            
  });     
